//! ASCII DXF reader (R12 … 2018) producing the drawing model.

use crate::aci::ACI;
use crate::geom::{catmull_rom, nurbs, D2R};
use crate::model::*;
use std::collections::HashMap;
use std::f64::consts::PI;

pub struct Parsed {
    /// $INSUNITS (0 unitless, 4 mm, 5 cm, 6 m …)
    pub units: i64,
    pub layers: Layers,
    pub blocks: HashMap<String, Block>,
    pub ents: Vec<Ent>,
    pub skipped: usize,
    pub layouts: Vec<Layout>,
}

// ---------------------------------------------------------------- decoding
fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).position(|w| w == needle)
}
fn header_value<'a>(head: &'a str, var: &str, code: &str) -> Option<&'a str> {
    let at = head.find(var)?;
    let mut lines = head[at + var.len()..].lines();
    lines.next(); // rest of the "$VAR" line
    loop {
        let c = lines.next()?.trim();
        let v = lines.next()?;
        if c == code {
            return Some(v.trim());
        }
        if c == "9" || c == "0" {
            return None;
        }
    }
}

/// Decodes the file without copying it when it is valid UTF-8 (big drawings are hundreds of MB).
pub fn decode(bytes: &[u8]) -> Result<std::borrow::Cow<'_, str>, String> {
    use std::borrow::Cow;
    if bytes.starts_with(b"AutoCAD Binary DXF") {
        return Err("Двоичный DXF не поддерживается — сохраните его как ASCII DXF".into());
    }
    let head_len = bytes.len().min(256 * 1024);
    let head = String::from_utf8_lossy(&bytes[..head_len]).into_owned();
    let ver = header_value(&head, "$ACADVER", "1").unwrap_or("AC1009").to_string();
    let utf8 = ver.as_str() >= "AC1021";
    let text: Cow<str> = match std::str::from_utf8(bytes) {
        Ok(t) if utf8 || find(&bytes[..head_len], b"$DWGCODEPAGE").is_none() => Cow::Borrowed(t),
        _ if utf8 => Cow::Owned(String::from_utf8_lossy(bytes).into_owned()),
        _ => {
            let cp = header_value(&head, "$DWGCODEPAGE", "3").unwrap_or("ANSI_1251").to_uppercase();
            let enc = if cp.contains("1252") {
                encoding_rs::WINDOWS_1252
            } else if cp.contains("1250") {
                encoding_rs::WINDOWS_1250
            } else if cp.contains("866") {
                encoding_rs::IBM866
            } else if cp.contains("1253") {
                encoding_rs::WINDOWS_1253
            } else if cp.contains("1254") {
                encoding_rs::WINDOWS_1254
            } else {
                encoding_rs::WINDOWS_1251
            };
            Cow::Owned(enc.decode(bytes).0.into_owned())
        }
    };
    if text.contains("\\U+") || text.contains("\\u+") {
        return Ok(Cow::Owned(unescape_u(&text)));
    }
    Ok(text)
}

/// "\U+0416" -> 'Ж'
pub fn unescape_u(s: &str) -> String {
    if !s.contains("\\U+") && !s.contains("\\u+") {
        return s.to_string();
    }
    let mut out = String::with_capacity(s.len());
    let b = s.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'\\' && i + 6 < b.len() + 1 && i + 2 < b.len() && (b[i + 1] == b'U' || b[i + 1] == b'u') && b[i + 2] == b'+' && i + 7 <= b.len() {
            if let Ok(h) = std::str::from_utf8(&b[i + 3..i + 7]) {
                if let Ok(v) = u32::from_str_radix(h, 16) {
                    if let Some(c) = char::from_u32(v) {
                        out.push(c);
                        i += 7;
                        continue;
                    }
                }
            }
        }
        let ch = s[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    out
}

// ---------------------------------------------------------------- tokens
type Tok<'a> = (i32, &'a str);

/// Streaming reader over group-code / value pairs: only one record is held in memory at a time.
struct Reader<'a> {
    lines: std::str::Split<'a, char>,
    peeked: Option<Tok<'a>>,
}
impl<'a> Reader<'a> {
    fn new(text: &'a str) -> Self {
        Reader { lines: text.split('\n'), peeked: None }
    }
    fn read(&mut self) -> Option<Tok<'a>> {
        loop {
            let c = self.lines.next()?;
            let v = self.lines.next()?;
            if let Ok(code) = c.trim().parse::<i32>() {
                return Some((code, v.strip_suffix('\r').unwrap_or(v)));
            }
        }
    }
    fn peek(&mut self) -> Option<Tok<'a>> {
        if self.peeked.is_none() {
            self.peeked = self.read();
        }
        self.peeked
    }
    fn next(&mut self) -> Option<Tok<'a>> {
        match self.peeked.take() {
            Some(t) => Some(t),
            None => self.read(),
        }
    }
    /// skips to the next "0" pair and returns its (trimmed) value without consuming it
    fn peek_kind(&mut self) -> Option<&'a str> {
        loop {
            let t = self.peek()?;
            if t.0 == 0 {
                return Some(t.1.trim());
            }
            self.peeked = None;
        }
    }
    /// collects the pairs up to the next "0" into `buf`
    fn body(&mut self, buf: &mut Vec<Tok<'a>>) {
        buf.clear();
        while let Some(t) = self.peek() {
            if t.0 == 0 {
                break;
            }
            buf.push(t);
            self.peeked = None;
        }
    }
}
#[inline]
fn fv(v: &str) -> f64 {
    v.trim().parse::<f64>().unwrap_or(0.0)
}
#[inline]
fn iv(v: &str) -> i64 {
    let t = v.trim();
    t.parse::<i64>().unwrap_or_else(|_| t.parse::<f64>().map(|f| f as i64).unwrap_or(0))
}

struct Rec<'a> {
    p: &'a [Tok<'a>],
}
impl<'a> Rec<'a> {
    fn get(&self, code: i32) -> Option<&'a str> {
        self.p.iter().find(|t| t.0 == code).map(|t| t.1)
    }
    fn f(&self, code: i32) -> Option<f64> {
        self.get(code).map(fv)
    }
    fn fd(&self, code: i32, d: f64) -> f64 {
        self.f(code).unwrap_or(d)
    }
    fn i(&self, code: i32) -> Option<i64> {
        self.get(code).map(iv)
    }
    fn pt(&self, cx: i32) -> P {
        P::new(self.fd(cx, 0.0), self.fd(cx + 10, 0.0))
    }
    fn text(&self, code: i32) -> String {
        self.get(code).unwrap_or("").to_string()
    }
}

// ---------------------------------------------------------------- text cleanup
pub fn clean_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut it = s.chars().peekable();
    while let Some(c) = it.next() {
        if c == '%' && it.peek() == Some(&'%') {
            it.next();
            match it.next() {
                Some('c') | Some('C') => out.push('Ø'),
                Some('d') | Some('D') => out.push('°'),
                Some('p') | Some('P') => out.push('±'),
                Some('u') | Some('U') | Some('o') | Some('O') | Some('k') | Some('K') => {}
                Some('%') => out.push('%'),
                Some(x) if x.is_ascii_digit() => {
                    let mut n = x.to_string();
                    while let Some(d) = it.peek().copied().filter(|d| d.is_ascii_digit()) {
                        n.push(d);
                        it.next();
                    }
                    if let Some(ch) = n.parse::<u32>().ok().and_then(char::from_u32) {
                        out.push(ch);
                    }
                }
                Some(x) => {
                    out.push_str("%%");
                    out.push(x)
                }
                None => out.push_str("%%"),
            }
        } else {
            out.push(c);
        }
    }
    out
}

pub fn clean_mtext(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let ch: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < ch.len() {
        let c = ch[i];
        if c == '\\' && i + 1 < ch.len() {
            let n = ch[i + 1];
            match n {
                'P' => { out.push('\n'); i += 2; }
                '~' => { out.push(' '); i += 2; }
                '\\' | '{' | '}' => { out.push(n); i += 2; }
                'L' | 'l' | 'O' | 'o' | 'K' | 'k' | 'N' => { i += 2; }
                'S' => {
                    // stacked fraction \Snum^den;
                    let mut j = i + 2;
                    let mut frac = String::new();
                    while j < ch.len() && ch[j] != ';' {
                        frac.push(if ch[j] == '^' || ch[j] == '#' { '/' } else { ch[j] });
                        j += 1;
                    }
                    out.push_str(frac.trim());
                    i = j + 1;
                }
                'A' | 'C' | 'c' | 'F' | 'f' | 'H' | 'h' | 'Q' | 'q' | 'T' | 't' | 'W' | 'w' | 'p' => {
                    let mut j = i + 2;
                    while j < ch.len() && ch[j] != ';' {
                        j += 1;
                    }
                    i = j + 1;
                }
                _ => { i += 1; }
            }
        } else if c == '{' || c == '}' {
            i += 1;
        } else {
            out.push(c);
            i += 1;
        }
    }
    clean_text(&out)
}

// ---------------------------------------------------------------- entities
struct Ctx<'a> {
    layers: &'a mut Layers,
    /// viewports met so far, with the paper-space block they belong to
    vps: Vec<(Viewport, String)>,
    /// paper-space entities of the active layout (ENTITIES with 67=1)
    paper: Vec<Ent>,
    /// block being read ("" in ENTITIES)
    block: String,
}

/// DXF transparency value: 0x02000000 | alpha byte; 0x01000000 = ByBlock; absent = ByLayer
/// (LibreDWG writes just the alpha byte, AutoCAD writes type << 24 | alpha.) Some(0) = ByBlock.
fn transparency(v: i64) -> Option<u8> {
    if v & 0x02000000 != 0 || (1..=255).contains(&v) { Some(((v & 255) as u8).max(1)) } else if v & 0x01000000 != 0 { Some(0) } else { None }
}
fn ent_alpha(r: &Rec) -> Option<u8> {
    r.i(440).and_then(transparency)
}

fn common(r: &Rec, ctx: &mut Ctx) -> (u32, Option<u32>, bool) {
    let lname = r.get(8).map(|s| s.trim()).filter(|s| !s.is_empty()).unwrap_or("0");
    let layer = ctx.layers.get_or_add(lname, 0xffffff);
    let mut color = None;
    let mut by_block = false;
    if let Some(tc) = r.i(420) {
        color = Some((tc as u32) & 0xffffff);
    } else if let Some(ci) = r.i(62) {
        let ci = ci.unsigned_abs() as usize;
        if ci == 0 {
            by_block = true;
        } else if ci < 256 {
            color = Some(ACI[ci]);
        }
    }
    (layer, color, by_block)
}

#[inline]
fn flip(p: P, neg: bool) -> P {
    if neg { P::new(-p.x, p.y) } else { p }
}

fn text_from(r: &Rec, valign_code: i32, neg: bool) -> TextData {
    let ha = r.i(72).unwrap_or(0);
    let va = r.i(valign_code).unwrap_or(0);
    let aligned = (ha != 0 || va != 0) && ha != 3 && ha != 5 && r.get(11).is_some();
    let p = if aligned { r.pt(11) } else { r.pt(10) };
    let mut rot = r.fd(50, 0.0);
    if neg {
        rot = 180.0 - rot;
    }
    TextData {
        p: flip(p, neg),
        h: r.fd(40, 2.5).abs().max(1e-9),
        text: clean_text(&r.text(1)),
        rot,
        halign: if ha == 3 || ha == 5 { 0.0 } else { ha as f64 },
        valign: va as f64,
        mtext: false,
        wf: r.f(41).filter(|w| *w > 0.0).unwrap_or(1.0),
        mask: None,
        mk: 1.0,
    }
}

/// MTEXT background mask (code 90 flags: 1 = fill, 2 = use the drawing background colour)
fn mtext_mask(r: &Rec) -> (Option<u32>, f64) {
    let f = r.i(90).unwrap_or(0);
    if f & 1 == 0 && f & 2 == 0 {
        return (None, 1.0);
    }
    let k = r.f(45).filter(|k| *k >= 1.0).unwrap_or(1.5);
    if f & 2 != 0 {
        return (Some(BG_MASK), k);
    }
    let col = r.i(421).map(|c| c as u32 & 0xffffff).or_else(|| r.i(63).map(|ci| ACI[(ci.unsigned_abs() as usize).clamp(1, 255)]));
    (Some(col.unwrap_or(BG_MASK)), k)
}

fn hatch_from(p: &[Tok], neg: bool) -> Option<Geo> {
    let mut i = 0;
    let n = p.len();
    let mut solid = false;
    let mut loops: Vec<Vec<V>> = Vec::new();
    let mut pattern: Vec<PatLine> = Vec::new();
    // header part until 91
    while i < n && p[i].0 != 91 {
        if p[i].0 == 70 {
            solid = iv(p[i].1) == 1;
        }
        i += 1;
    }
    if i >= n {
        return None;
    }
    let npaths = iv(p[i].1).max(0) as usize;
    i += 1;
    let next = |i: &mut usize, code: i32| -> Option<f64> {
        // advance to the next token with this code (bounded look-ahead)
        let start = *i;
        while *i < n && *i < start + 64 {
            if p[*i].0 == code {
                let v = fv(p[*i].1);
                *i += 1;
                return Some(v);
            }
            *i += 1;
        }
        None
    };
    for _ in 0..npaths {
        let Some(flags) = next(&mut i, 92) else { break };
        let flags = flags as i64;
        let mut lp: Vec<V> = Vec::new();
        if flags & 2 != 0 {
            let has_b = next(&mut i, 72).unwrap_or(0.0) != 0.0;
            let _closed = next(&mut i, 73);
            let nv = next(&mut i, 93).unwrap_or(0.0) as usize;
            for _ in 0..nv {
                let x = next(&mut i, 10).unwrap_or(0.0);
                let y = next(&mut i, 20).unwrap_or(0.0);
                let mut b = 0.0;
                if has_b && i < n && p[i].0 == 42 {
                    b = fv(p[i].1);
                    i += 1;
                }
                lp.push(V { x, y, b });
            }
        } else {
            let ne = next(&mut i, 93).unwrap_or(0.0) as usize;
            for _ in 0..ne {
                let et = next(&mut i, 72).unwrap_or(1.0) as i64;
                match et {
                    1 => {
                        let x = next(&mut i, 10).unwrap_or(0.0);
                        let y = next(&mut i, 20).unwrap_or(0.0);
                        let _ = next(&mut i, 11);
                        let _ = next(&mut i, 21);
                        lp.push(V { x, y, b: 0.0 });
                    }
                    2 => {
                        let cx = next(&mut i, 10).unwrap_or(0.0);
                        let cy = next(&mut i, 20).unwrap_or(0.0);
                        let r = next(&mut i, 40).unwrap_or(0.0);
                        let s = next(&mut i, 50).unwrap_or(0.0);
                        let e = next(&mut i, 51).unwrap_or(0.0);
                        let ccw = next(&mut i, 73).unwrap_or(1.0) != 0.0;
                        let (a0, mut sweep) = if ccw { (s, e - s) } else { (-s, -(e - s)) };
                        if ccw && sweep <= 0.0 {
                            sweep += 360.0;
                        }
                        if !ccw && sweep >= 0.0 {
                            sweep -= 360.0;
                        }
                        // split into ≤90° pieces expressed as bulges
                        let pieces = ((sweep.abs() / 90.0).ceil() as usize).max(1);
                        for k in 0..pieces {
                            let a = (a0 + sweep * k as f64 / pieces as f64) * D2R;
                            let b = ((sweep / pieces as f64) * D2R / 4.0).tan();
                            lp.push(V { x: cx + r * a.cos(), y: cy + r * a.sin(), b });
                        }
                    }
                    3 => {
                        let cx = next(&mut i, 10).unwrap_or(0.0);
                        let cy = next(&mut i, 20).unwrap_or(0.0);
                        let mx = next(&mut i, 11).unwrap_or(1.0);
                        let my = next(&mut i, 21).unwrap_or(0.0);
                        let ratio = next(&mut i, 40).unwrap_or(1.0);
                        let s = next(&mut i, 50).unwrap_or(0.0) * D2R;
                        let e = next(&mut i, 51).unwrap_or(360.0) * D2R;
                        let ccw = next(&mut i, 73).unwrap_or(1.0) != 0.0;
                        let (t0, mut sw) = if ccw { (s, e - s) } else { (-s, -(e - s)) };
                        if ccw && sw <= 0.0 {
                            sw += 2.0 * PI;
                        }
                        if !ccw && sw >= 0.0 {
                            sw -= 2.0 * PI;
                        }
                        let k = 24;
                        for j in 0..k {
                            let t = t0 + sw * j as f64 / k as f64;
                            let (st, ct) = t.sin_cos();
                            lp.push(V { x: cx + mx * ct - my * ratio * st, y: cy + my * ct + mx * ratio * st, b: 0.0 });
                        }
                    }
                    4 => {
                        let deg = next(&mut i, 94).unwrap_or(3.0) as usize;
                        let rational = next(&mut i, 73).unwrap_or(0.0) != 0.0;
                        let _periodic = next(&mut i, 74);
                        let nk = next(&mut i, 95).unwrap_or(0.0) as usize;
                        let nc = next(&mut i, 96).unwrap_or(0.0) as usize;
                        let mut knots = Vec::with_capacity(nk);
                        for _ in 0..nk {
                            knots.push(next(&mut i, 40).unwrap_or(0.0));
                        }
                        let mut ctrl = Vec::with_capacity(nc);
                        let mut w = Vec::new();
                        for _ in 0..nc {
                            let x = next(&mut i, 10).unwrap_or(0.0);
                            let y = next(&mut i, 20).unwrap_or(0.0);
                            ctrl.push(P::new(x, y));
                            if rational && i < n && p[i].0 == 42 {
                                w.push(fv(p[i].1));
                                i += 1;
                            }
                        }
                        // optional fit data
                        if i < n && p[i].0 == 97 {
                            let nf = iv(p[i].1) as usize;
                            i += 1;
                            for _ in 0..nf {
                                let _ = next(&mut i, 11);
                                let _ = next(&mut i, 21);
                            }
                            while i < n && (p[i].0 == 12 || p[i].0 == 22 || p[i].0 == 13 || p[i].0 == 23) {
                                i += 1;
                            }
                        }
                        let pts = nurbs(&ctrl, &w, deg, &knots, (nc * 6).clamp(8, 200));
                        for q in pts.iter().take(pts.len().saturating_sub(1).max(1)) {
                            lp.push(V { x: q.x, y: q.y, b: 0.0 });
                        }
                    }
                    _ => {}
                }
            }
        }
        // source boundary objects
        if i < n && p[i].0 == 97 {
            let ns = iv(p[i].1).max(0) as usize;
            i += 1;
            let mut k = 0;
            while k < ns && i < n && p[i].0 == 330 {
                i += 1;
                k += 1;
            }
        }
        if lp.len() >= 2 {
            loops.push(lp);
        }
    }
    // pattern definition
    while i < n {
        match p[i].0 {
            78 => {
                let nl = iv(p[i].1).max(0) as usize;
                i += 1;
                for _ in 0..nl {
                    let ang = next(&mut i, 53).unwrap_or(0.0);
                    let bx = next(&mut i, 43).unwrap_or(0.0);
                    let by = next(&mut i, 44).unwrap_or(0.0);
                    let ox = next(&mut i, 45).unwrap_or(0.0);
                    let oy = next(&mut i, 46).unwrap_or(0.0);
                    let nd = next(&mut i, 79).unwrap_or(0.0) as usize;
                    let mut dashes = Vec::with_capacity(nd);
                    for _ in 0..nd {
                        if i < n && p[i].0 == 49 {
                            dashes.push(fv(p[i].1));
                            i += 1;
                        }
                    }
                    pattern.push(PatLine { ang, bx, by, ox, oy, dashes });
                }
            }
            450 => {
                // gradient fill -> draw as solid
                solid = true;
                i += 1;
            }
            _ => i += 1,
        }
    }
    if loops.is_empty() {
        return None;
    }
    if neg {
        for lp in &mut loops {
            for v in lp.iter_mut() {
                v.x = -v.x;
                v.b = -v.b;
            }
        }
        for pl in &mut pattern {
            pl.bx = -pl.bx;
            pl.ox = -pl.ox;
            pl.ang = 180.0 - pl.ang;
        }
    }
    if !solid && pattern.is_empty() {
        // e.g. a pattern we could not read: show as a light fill outline only
        return Some(Geo::Hatch { loops, solid: false, pattern });
    }
    Some(Geo::Hatch { loops, solid, pattern })
}

/// Parse one entity record (pairs after its "0 TYPE"). Returns None for unsupported/invisible.
fn entity(kind: &str, r: &Rec, ctx: &mut Ctx) -> Option<Ent> {
    if r.i(60) == Some(1) {
        return None; // invisible
    }
    let neg = r.f(230).map(|z| z < 0.0).unwrap_or(false);
    let (layer, color, by_block) = common(r, ctx);
    let geo = match kind {
        "LINE" => Geo::Line { p1: r.pt(10), p2: r.pt(11) },
        "POINT" => Geo::Point { p: r.pt(10) },
        "CIRCLE" => Geo::Circle { c: flip(r.pt(10), neg), r: r.fd(40, 0.0).abs() },
        "ARC" => {
            let (a0, a1) = (r.fd(50, 0.0), r.fd(51, 360.0));
            let (a0, a1) = if neg { (180.0 - a1, 180.0 - a0) } else { (a0, a1) };
            Geo::Arc { c: flip(r.pt(10), neg), r: r.fd(40, 0.0).abs(), a0, a1 }
        }
        "ELLIPSE" => {
            let mut c = r.pt(10);
            let mut major = r.pt(11);
            let (mut t0, mut t1) = (r.fd(41, 0.0), r.fd(42, 2.0 * PI));
            if neg {
                c.x = -c.x;
                major.x = -major.x;
                let (a, b) = (-t1, -t0);
                t0 = a;
                t1 = b;
            }
            Geo::Ellipse { c, major, ratio: r.fd(40, 1.0), t0, t1 }
        }
        "LWPOLYLINE" => {
            let mut pts: Vec<V> = Vec::new();
            for &(c, v) in r.p {
                match c {
                    10 => pts.push(V { x: fv(v), y: 0.0, b: 0.0 }),
                    20 => {
                        if let Some(l) = pts.last_mut() {
                            l.y = fv(v)
                        }
                    }
                    42 => {
                        if let Some(l) = pts.last_mut() {
                            l.b = fv(v)
                        }
                    }
                    _ => {}
                }
            }
            if neg {
                for p in pts.iter_mut() {
                    p.x = -p.x;
                    p.b = -p.b;
                }
            }
            if pts.len() < 2 {
                return None;
            }
            Geo::Poly { pts, closed: r.i(70).unwrap_or(0) & 1 != 0, filled: false }
        }
        "SOLID" | "TRACE" | "3DFACE" => {
            let v: Vec<P> = (0..4).map(|k| flip(r.pt(10 + k), neg && kind != "3DFACE")).collect();
            let mut pts: Vec<V> = if kind == "3DFACE" { v.clone() } else { vec![v[0], v[1], v[3], v[2]] }
                .into_iter()
                .map(|p| V { x: p.x, y: p.y, b: 0.0 })
                .collect();
            pts.dedup_by(|a, b| a.x == b.x && a.y == b.y);
            if pts.len() > 1 && pts[0].x == pts[pts.len() - 1].x && pts[0].y == pts[pts.len() - 1].y {
                pts.pop();
            }
            if pts.len() < 2 {
                return None;
            }
            Geo::Poly { pts, closed: true, filled: kind != "3DFACE" }
        }
        "TEXT" => Geo::Text(text_from(r, 73, neg)),
        "MTEXT" => {
            let mut raw = String::new();
            for &(c, v) in r.p {
                if c == 3 || c == 1 {
                    raw.push_str(v);
                }
            }
            let ap = r.i(71).unwrap_or(1).clamp(1, 9);
            let mut rot = r.fd(50, 0.0);
            if r.get(50).is_none() && r.get(11).is_some() {
                let d = r.pt(11);
                rot = d.y.atan2(d.x) / D2R;
            }
            Geo::Text(TextData {
                p: r.pt(10),
                h: r.fd(40, 2.5).abs().max(1e-9),
                text: clean_mtext(&raw),
                rot,
                halign: [0.0, 1.0, 2.0][((ap - 1) % 3) as usize],
                valign: [3.0, 2.0, 1.0][((ap - 1) / 3) as usize],
                mtext: true,
                wf: 1.0,
                mask: mtext_mask(r).0,
                mk: mtext_mask(r).1,
            })
        }
        "INSERT" => {
            let name = r.text(2);
            if name.is_empty() {
                return None;
            }
            let mut sx = r.fd(41, 1.0);
            let sy = r.fd(42, 1.0);
            let mut rot = r.fd(50, 0.0);
            let mut p = r.pt(10);
            if neg {
                p.x = -p.x;
                rot = -rot;
                sx = -sx;
            }
            Geo::Insert {
                block: name,
                p,
                sx,
                sy,
                rot,
                cols: r.i(70).unwrap_or(1).max(1) as u32,
                rows: r.i(71).unwrap_or(1).max(1) as u32,
                cs: r.fd(44, 0.0),
                rs: r.fd(45, 0.0),
                attribs: Vec::new(),
            }
        }
        "MLINE" => {
            let mut pts: Vec<V> = Vec::new();
            for &(c, v) in r.p {
                match c {
                    11 => pts.push(V { x: fv(v), y: 0.0, b: 0.0 }),
                    21 => {
                        if let Some(l) = pts.last_mut() {
                            l.y = fv(v)
                        }
                    }
                    _ => {}
                }
            }
            if pts.len() < 2 {
                return None;
            }
            Geo::Poly { pts, closed: r.i(71).unwrap_or(0) & 2 != 0, filled: false }
        }
        "DIMENSION" | "ARC_DIMENSION" | "LARGE_RADIAL_DIMENSION" => {
            let name = r.text(2);
            if name.is_empty() {
                return None;
            }
            Geo::Insert { block: name, p: P::new(0.0, 0.0), sx: 1.0, sy: 1.0, rot: 0.0, cols: 1, rows: 1, cs: 0.0, rs: 0.0, attribs: Vec::new() }
        }
        "LEADER" => {
            let mut pts: Vec<V> = Vec::new();
            for &(c, v) in r.p {
                match c {
                    10 => pts.push(V { x: fv(v), y: 0.0, b: 0.0 }),
                    20 => {
                        if let Some(l) = pts.last_mut() {
                            l.y = fv(v)
                        }
                    }
                    _ => {}
                }
            }
            if pts.len() < 2 {
                return None;
            }
            Geo::Poly { pts, closed: false, filled: false }
        }
        "HATCH" => hatch_from(r.p, neg)?,
        _ => return None,
    };
    Some(Ent { layer, color, by_block, alpha: ent_alpha(r), geo })
}

/// Reads entities until a "0" record named one of `stop` (not consumed).
fn read_entities<'a>(rd: &mut Reader<'a>, stop: &[&str], ctx: &mut Ctx, skip_paper: bool, out: &mut Vec<Ent>, skipped: &mut usize) {
    let mut buf: Vec<Tok<'a>> = Vec::new();
    let mut sub: Vec<Tok<'a>> = Vec::new();
    loop {
        let Some(kind) = rd.peek_kind() else { return };
        if stop.contains(&kind) {
            return;
        }
        rd.next();
        rd.body(&mut buf);
        let rec = Rec { p: &buf };
        // paper-space entities of the active layout: kept aside for the «Лист» tabs
        let paper_rec = skip_paper && rec.i(67) == Some(1);
        let paper = false;
        if kind == "VIEWPORT" {
            ctx.vps.push((viewport_from(&rec), if paper_rec || !skip_paper { ctx.block.clone() } else { String::new() }));
            continue;
        }
        let n0 = out.len();
        'rec: { match kind {
            "POLYLINE" => {
                let flags = rec.i(70).unwrap_or(0);
                let neg = rec.f(230).map(|z| z < 0.0).unwrap_or(false);
                let mut pts: Vec<V> = Vec::new();
                let mut faces: Vec<[i64; 4]> = Vec::new();
                let mut mesh_pts: Vec<P> = Vec::new();
                while rd.peek_kind() == Some("VERTEX") {
                    rd.next();
                    rd.body(&mut sub);
                    let vr = Rec { p: &sub };
                    let vf = vr.i(70).unwrap_or(0);
                    if flags & 64 != 0 {
                        // polyface mesh: coordinate vertices (64|128) and face records (128 only)
                        if vf & 64 != 0 {
                            mesh_pts.push(P::new(vr.fd(10, 0.0), vr.fd(20, 0.0)));
                        } else if vf & 128 != 0 {
                            faces.push([vr.i(71).unwrap_or(0), vr.i(72).unwrap_or(0), vr.i(73).unwrap_or(0), vr.i(74).unwrap_or(0)]);
                        }
                        continue;
                    }
                    if vf & 128 != 0 {
                        continue;
                    }
                    if vf & 16 != 0 {
                        continue; // spline frame control point
                    }
                    let mut x = vr.fd(10, 0.0);
                    let mut b = vr.fd(42, 0.0);
                    if neg && flags & 8 == 0 {
                        x = -x;
                        b = -b;
                    }
                    pts.push(V { x, y: vr.fd(20, 0.0), b });
                }
                if rd.peek_kind() == Some("SEQEND") {
                    rd.next();
                    rd.body(&mut sub);
                }
                if flags & 64 != 0 && !paper && rec.i(60) != Some(1) {
                    let (layer, color, by_block) = common(&rec, ctx);
                    for f in &faces {
                        // visible edges of each face (negative index = invisible edge)
                        let idx: Vec<i64> = f.iter().copied().filter(|&k| k != 0).collect();
                        for k in 0..idx.len() {
                            let (a, b) = (idx[k], idx[(k + 1) % idx.len()]);
                            if a < 0 {
                                continue;
                            }
                            let (pa, pb) = (mesh_pts.get(a.unsigned_abs() as usize - 1), mesh_pts.get(b.unsigned_abs() as usize - 1));
                            if let (Some(pa), Some(pb)) = (pa, pb) {
                                out.push(Ent { layer, color, by_block, alpha: ent_alpha(&rec), geo: Geo::Line { p1: *pa, p2: *pb } });
                            }
                        }
                    }
                    break 'rec;
                }
                if flags & 16 != 0 || pts.len() < 2 || paper || rec.i(60) == Some(1) {
                    *skipped += 1;
                    break 'rec;
                }
                let (layer, color, by_block) = common(&rec, ctx);
                out.push(Ent { layer, color, by_block, alpha: ent_alpha(&rec), geo: Geo::Poly { pts, closed: flags & 1 != 0, filled: false } });
            }
            "INSERT" => {
                let ent = entity(kind, &rec, ctx);
                let mut attribs = Vec::new();
                if rec.i(66) == Some(1) {
                    while rd.peek_kind() == Some("ATTRIB") {
                        rd.next();
                        rd.body(&mut sub);
                        let ar = Rec { p: &sub };
                        if ar.i(70).unwrap_or(0) & 1 == 0 && ar.i(60) != Some(1) {
                            let neg = ar.f(230).map(|z| z < 0.0).unwrap_or(false);
                            let t = text_from(&ar, 74, neg);
                            if !t.text.is_empty() {
                                attribs.push(t);
                            }
                        }
                    }
                    if rd.peek_kind() == Some("SEQEND") {
                        rd.next();
                        rd.body(&mut sub);
                    }
                }
                match ent {
                    Some(mut e) if !paper => {
                        if let Geo::Insert { attribs: a, .. } = &mut e.geo {
                            *a = attribs;
                        }
                        out.push(e)
                    }
                    _ => *skipped += 1,
                }
            }
            "SPLINE" => {
                if paper {
                    break 'rec;
                }
                let (layer, color, by_block) = common(&rec, ctx);
                let flags = rec.i(70).unwrap_or(0);
                let deg = rec.i(71).unwrap_or(3).max(1) as usize;
                let mut knots = Vec::new();
                let mut weights = Vec::new();
                let mut ctrl: Vec<P> = Vec::new();
                let mut fit: Vec<P> = Vec::new();
                for &(c, v) in rec.p {
                    match c {
                        40 => knots.push(fv(v)),
                        41 => weights.push(fv(v)),
                        10 => ctrl.push(P::new(fv(v), 0.0)),
                        20 => {
                            if let Some(l) = ctrl.last_mut() {
                                l.y = fv(v)
                            }
                        }
                        11 => fit.push(P::new(fv(v), 0.0)),
                        21 => {
                            if let Some(l) = fit.last_mut() {
                                l.y = fv(v)
                            }
                        }
                        _ => {}
                    }
                }
                let pts = if ctrl.len() > 1 {
                    nurbs(&ctrl, &weights, deg, &knots, (ctrl.len() * 8).clamp(32, 2000))
                } else if fit.len() > 1 {
                    catmull_rom(&fit, 12, flags & 1 != 0)
                } else {
                    *skipped += 1;
                    break 'rec;
                };
                out.push(Ent { layer, color, by_block, alpha: ent_alpha(&rec), geo: Geo::Poly { pts: pts.into_iter().map(|p| V { x: p.x, y: p.y, b: 0.0 }).collect(), closed: false, filled: false } });
            }
            "VERTEX" | "SEQEND" | "ATTRIB" | "ATTDEF" | "ENDBLK" => {}
            _ => match entity(kind, &rec, ctx) {
                Some(e) if !paper => out.push(e),
                _ => *skipped += 1,
            },
        } }
        if paper_rec && out.len() > n0 {
            let moved: Vec<Ent> = out.drain(n0..).collect();
            ctx.paper.extend(moved);
        }
    }
}

fn viewport_from(r: &Rec) -> Viewport {
    let (tx, ty) = (r.fd(17, 0.0), r.fd(27, 0.0));
    let (dx, dy) = (r.fd(12, 0.0), r.fd(22, 0.0));
    let twist = r.fd(51, 0.0);
    // view centre: target + DCS centre (rotated by the view twist)
    let (sn, co) = (-twist * D2R).sin_cos();
    Viewport {
        cx: r.fd(10, 0.0),
        cy: r.fd(20, 0.0),
        w: r.fd(40, 0.0),
        h: r.fd(41, 0.0),
        mx: tx + dx * co - dy * sn,
        my: ty + dx * sn + dy * co,
        vh: r.fd(45, 1.0),
        twist,
        id: r.i(69).unwrap_or(0),
        on: true,
    }
}

pub fn parse(text: &str) -> Parsed {
    let mut rd = Reader::new(text);
    let mut layers = Layers::default();
    layers.get_or_add("0", 0xffffff);
    let mut blocks: HashMap<String, Block> = HashMap::new();
    let mut ents = Vec::new();
    let mut skipped = 0usize;
    let mut units = 0i64;
    let mut buf: Vec<Tok> = Vec::new();
    let mut vps: Vec<(Viewport, String)> = Vec::new();
    let mut paper_blocks: HashMap<String, Vec<Ent>> = HashMap::new();
    let mut active_paper: Vec<Ent> = Vec::new();
    let mut block_of_record: HashMap<String, String> = HashMap::new();
    let mut layout_recs: Vec<(String, i64, String, f64, f64, i64)> = Vec::new();
    while let Some(kind) = rd.peek_kind() {
        rd.next();
        if kind != "SECTION" {
            continue;
        }
        let name = match rd.peek() {
            Some((2, v)) => {
                rd.next();
                v.trim().to_string()
            }
            _ => String::new(),
        };
        match name.as_str() {
            "HEADER" => {
                while let Some(t) = rd.next() {
                    if t.0 == 0 && t.1.trim() == "ENDSEC" {
                        break;
                    }
                    if t.0 == 9 && t.1.trim() == "$INSUNITS" {
                        if let Some((70, v)) = rd.peek() {
                            units = iv(v);
                        }
                    }
                }
                continue;
            }
            "TABLES" => {
                while let Some(k) = rd.peek_kind() {
                    if k == "ENDSEC" {
                        break;
                    }
                    rd.next();
                    rd.body(&mut buf);
                    if k != "LAYER" {
                        continue;
                    }
                    let r = Rec { p: &buf };
                    let name = r.text(2);
                    if !name.trim().is_empty() {
                        let ci = r.i(62).unwrap_or(7);
                        let col = r.i(420).map(|c| c as u32 & 0xffffff).unwrap_or_else(|| ACI[(ci.unsigned_abs() as usize).clamp(1, 255)]);
                        let idx = layers.get_or_add(name.trim(), col);
                        let l = &mut layers.list[idx as usize];
                        l.color = col;
                        l.visible = ci >= 0 && r.i(70).unwrap_or(0) & 1 == 0;
                        // layer transparency lives in xdata: 1001 AcCmTransparency / 1071 value
                        if let Some(k) = r.p.iter().position(|t| t.0 == 1001 && t.1.trim() == "AcCmTransparency") {
                            if let Some(t) = r.p[k + 1..].iter().take(3).find(|t| t.0 == 1071) {
                                if let Some(a) = transparency(iv(t.1)).filter(|&a| a > 0) {
                                    l.alpha = a;
                                }
                            }
                        }
                    }
                }
            }
            "BLOCKS" => {
                while let Some(k) = rd.peek_kind() {
                    if k == "ENDSEC" {
                        break;
                    }
                    rd.next();
                    rd.body(&mut buf);
                    if k != "BLOCK" {
                        continue;
                    }
                    let r = Rec { p: &buf };
                    let bname = r.get(2).or_else(|| r.get(3)).unwrap_or("").to_string();
                    let base = r.pt(10);
                    if let Some(h) = r.get(330) {
                        block_of_record.insert(h.trim().to_string(), bname.clone());
                    }
                    let mut bents = Vec::new();
                    let mut ctx = Ctx { layers: &mut layers, vps: Vec::new(), paper: Vec::new(), block: bname.clone() };
                    read_entities(&mut rd, &["ENDBLK", "ENDSEC"], &mut ctx, false, &mut bents, &mut 0);
                    vps.extend(ctx.vps);
                    if rd.peek_kind() == Some("ENDBLK") {
                        rd.next();
                        rd.body(&mut buf);
                    }
                    let lower = bname.to_ascii_lowercase();
                    if lower.starts_with("*paper_space") {
                        paper_blocks.insert(bname, bents);
                    } else if !bname.is_empty() && !lower.starts_with("*model_space") {
                        bents.shrink_to_fit();
                        blocks.insert(bname, Block { base, ents: bents });
                    }
                }
            }
            "ENTITIES" => {
                let mut ctx = Ctx { layers: &mut layers, vps: Vec::new(), paper: Vec::new(), block: "*Paper_Space".into() };
                read_entities(&mut rd, &["ENDSEC"], &mut ctx, true, &mut ents, &mut skipped);
                vps.extend(ctx.vps.into_iter().filter(|(_, b)| !b.is_empty()));
                active_paper = ctx.paper;
            }
            "OBJECTS" => {
                while let Some(k) = rd.peek_kind() {
                    if k == "ENDSEC" {
                        break;
                    }
                    rd.next();
                    rd.body(&mut buf);
                    if k != "LAYOUT" {
                        continue;
                    }
                    // plot settings come first, then the AcDbLayout part (name, tab order, block record)
                    let split = buf.iter().position(|t| t.0 == 100 && t.1.trim() == "AcDbLayout").unwrap_or(0);
                    let (ps, lo) = (Rec { p: &buf[..split] }, Rec { p: &buf[split..] });
                    let name = lo.text(1);
                    let rec_h = lo.p.iter().rev().find(|t| t.0 == 330).map(|t| t.1.trim().to_string()).unwrap_or_default();
                    layout_recs.push((name, lo.i(71).unwrap_or(0), rec_h, ps.fd(44, 0.0), ps.fd(45, 0.0), ps.i(73).unwrap_or(0)));
                }
            }
            _ => {}
        }
        // skip the rest of the section
        while let Some(k) = rd.peek_kind() {
            rd.next();
            if k == "ENDSEC" {
                break;
            }
        }
    }
    // ---- layouts: LAYOUT objects -> paper-space block -> viewports + sheet objects
    let mut layouts: Vec<Layout> = Vec::new();
    for (name, order, rec_h, pw, ph, rot) in layout_recs {
        let Some(block) = block_of_record.get(&rec_h).cloned() else { continue };
        if block.to_ascii_lowercase().starts_with("*model_space") || name.eq_ignore_ascii_case("model") {
            continue;
        }
        let (mut w, mut h) = (pw, ph);
        if rot == 1 || rot == 3 {
            std::mem::swap(&mut w, &mut h);
        }
        let mut lents = paper_blocks.remove(&block).unwrap_or_default();
        if block == "*Paper_Space" {
            lents.extend(std::mem::take(&mut active_paper));
        }
        // the first viewport of a layout is the sheet itself, not a window into the model
        let lvps: Vec<Viewport> = vps.iter().filter(|(_, b)| *b == block).map(|(v, _)| v.clone()).skip(1).collect();
        // never set up (template «Layout1» with nothing on it): no tab, like an empty sheet would be useless
        if lvps.is_empty() && lents.is_empty() {
            continue;
        }
        if w <= 0.0 || h <= 0.0 {
            // no paper size in the plot settings: take the box of the viewports, at least A3
            let (mut x2, mut y2) = (420.0f64, 297.0f64);
            for v in &lvps {
                x2 = x2.max(v.cx + v.w / 2.0);
                y2 = y2.max(v.cy + v.h / 2.0);
            }
            w = x2;
            h = y2;
        }
        layouts.push(Layout { name, order, block, w, h, rot, vps: lvps, ents: lents });
    }
    if layouts.is_empty() && (!active_paper.is_empty() || vps.iter().any(|(_, b)| b == "*Paper_Space")) {
        let lvps: Vec<Viewport> = vps.iter().filter(|(_, b)| b == "*Paper_Space").map(|(v, _)| v.clone()).skip(1).collect();
        layouts.push(Layout { name: "Лист".into(), order: 1, block: "*Paper_Space".into(), w: 420.0, h: 297.0, rot: 0, vps: lvps, ents: active_paper });
    }
    layouts.sort_by_key(|l| l.order);
    Parsed { units, layers, blocks, ents, skipped, layouts }
}
