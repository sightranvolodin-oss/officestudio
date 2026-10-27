//! DXF R12 (AC1009) writer — the most widely readable flavour (AutoCAD, BricsCAD, nanoCAD, LibreCAD, KOMPAS).

use crate::aci::ACI;
use crate::engine::Drawing;
use crate::geom::*;
use crate::model::*;
use crate::tess::{hatch_lines, triangulate};
use std::collections::BTreeSet;
use std::fmt::Write;

pub fn nearest_aci(rgb: u32) -> i32 {
    let (r, g, b) = (((rgb >> 16) & 255) as i32, ((rgb >> 8) & 255) as i32, (rgb & 255) as i32);
    let mut best = 7;
    let mut bd = i32::MAX;
    for (i, &m) in ACI.iter().enumerate().skip(1) {
        let (mr, mg, mb) = (((m >> 16) & 255) as i32, ((m >> 8) & 255) as i32, (m & 255) as i32);
        let d = (mr - r).pow(2) + (mg - g).pow(2) + (mb - b).pow(2);
        if d < bd {
            bd = d;
            best = i as i32;
            if d == 0 {
                break;
            }
        }
    }
    best
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        if (' '..='~').contains(&c) {
            o.push(c);
        } else if c == '\t' {
            o.push(' ');
        } else if (c as u32) < 0x10000 {
            let _ = write!(o, "\\U+{:04X}", c as u32);
        } else {
            o.push('?');
        }
    }
    o
}
fn name(s: &str) -> String {
    let mut n = s.to_string();
    if let Some(rest) = n.strip_prefix('*') {
        n = format!("ANON_{rest}");
    }
    let cleaned: String = n.chars().map(|c| if "<>/\\\":;?*|=,`".contains(c) { '_' } else { c }).collect();
    let e = esc(&cleaned);
    if e.is_empty() { "0".into() } else { e.chars().take(255).collect() }
}
fn num(v: f64) -> String {
    if !v.is_finite() || v.abs() < 1e-12 {
        return "0.0".into();
    }
    let s = format!("{:.10}", v);
    let s = s.trim_end_matches('0');
    if s.ends_with('.') { format!("{s}0") } else { s.to_string() }
}

struct W {
    out: String,
}
impl W {
    fn g(&mut self, code: i32, val: &str) {
        let _ = write!(self.out, "{code}\r\n{val}\r\n");
    }
    fn n(&mut self, code: i32, v: f64) {
        let s = num(v);
        self.g(code, &s);
    }
    fn i(&mut self, code: i32, v: i64) {
        let _ = write!(self.out, "{code}\r\n{v}\r\n");
    }
}

pub fn write(d: &Drawing) -> Vec<u8> {
    let mut w = W { out: String::with_capacity(1 << 20) };
    let bb = d.extents(false);
    let (x1, y1, x2, y2) = if bb.valid() { (bb.x1, bb.y1, bb.x2, bb.y2) } else { (0.0, 0.0, 100.0, 100.0) };

    w.g(0, "SECTION");
    w.g(2, "HEADER");
    w.g(9, "$ACADVER");
    w.g(1, "AC1009");
    w.g(9, "$DWGCODEPAGE");
    w.g(3, "ANSI_1251");
    w.g(9, "$INSBASE");
    w.n(10, 0.0);
    w.n(20, 0.0);
    w.n(30, 0.0);
    w.g(9, "$EXTMIN");
    w.n(10, x1);
    w.n(20, y1);
    w.n(30, 0.0);
    w.g(9, "$EXTMAX");
    w.n(10, x2);
    w.n(20, y2);
    w.n(30, 0.0);
    w.g(9, "$LIMMIN");
    w.n(10, x1);
    w.n(20, y1);
    w.g(9, "$LIMMAX");
    w.n(10, x2);
    w.n(20, y2);
    w.g(0, "ENDSEC");

    // tables
    w.g(0, "SECTION");
    w.g(2, "TABLES");
    w.g(0, "TABLE");
    w.g(2, "LTYPE");
    w.i(70, 1);
    w.g(0, "LTYPE");
    w.g(2, "CONTINUOUS");
    w.i(70, 0);
    w.g(3, "Solid line");
    w.i(72, 65);
    w.i(73, 0);
    w.n(40, 0.0);
    w.g(0, "ENDTAB");
    let live: Vec<&Layer> = d.layers.list.iter().filter(|l| !l.deleted).collect();
    w.g(0, "TABLE");
    w.g(2, "LAYER");
    w.i(70, live.len() as i64);
    for l in &live {
        let aci = nearest_aci(l.color) as i64;
        w.g(0, "LAYER");
        w.g(2, &name(&l.name));
        w.i(70, 0);
        w.i(62, if l.visible { aci } else { -aci });
        w.g(6, "CONTINUOUS");
    }
    w.g(0, "ENDTAB");
    w.g(0, "TABLE");
    w.g(2, "STYLE");
    w.i(70, 1);
    w.g(0, "STYLE");
    w.g(2, "STANDARD");
    w.i(70, 0);
    w.n(40, 0.0);
    w.n(41, 1.0);
    w.n(50, 0.0);
    w.i(71, 0);
    w.n(42, 2.5);
    w.g(3, "txt");
    w.g(4, "");
    w.g(0, "ENDTAB");
    w.g(0, "ENDSEC");

    // used blocks (recursively)
    let mut used: BTreeSet<String> = BTreeSet::new();
    fn visit(d: &Drawing, ents: &mut dyn Iterator<Item = &Ent>, used: &mut BTreeSet<String>) {
        for e in ents {
            if let Geo::Insert { block, .. } = &e.geo {
                if d.blocks.contains_key(block) && used.insert(block.clone()) {
                    let b = &d.blocks[block];
                    visit(d, &mut b.ents.iter(), used);
                }
            }
        }
    }
    visit(d, &mut d.ents.iter().flatten(), &mut used);

    let mut hatch_blocks: Vec<(String, Vec<Ent>)> = Vec::new();
    let mut ents_out = W { out: String::with_capacity(1 << 20) };
    let lname = |i: u32| name(d.layers.name(i));
    for e in d.ents.iter().flatten() {
        write_ent(&mut ents_out, e, &lname(e.layer), d, &mut hatch_blocks);
    }
    w.g(0, "SECTION");
    w.g(2, "BLOCKS");
    for bn in &used {
        let b = &d.blocks[bn];
        let nm = name(bn);
        w.g(0, "BLOCK");
        w.g(8, "0");
        w.g(2, &nm);
        w.i(70, 0);
        w.n(10, b.base.x);
        w.n(20, b.base.y);
        w.n(30, 0.0);
        w.g(3, &nm);
        w.g(1, "");
        for e in &b.ents {
            write_ent(&mut w, e, &lname(e.layer), d, &mut hatch_blocks);
        }
        w.g(0, "ENDBLK");
        w.g(8, "0");
    }
    for (bn, ents) in &hatch_blocks {
        w.g(0, "BLOCK");
        w.g(8, "0");
        w.g(2, bn);
        w.i(70, 0);
        w.n(10, 0.0);
        w.n(20, 0.0);
        w.n(30, 0.0);
        w.g(3, bn);
        w.g(1, "");
        let mut none = Vec::new();
        for e in ents {
            write_ent(&mut w, e, "0", d, &mut none);
        }
        w.g(0, "ENDBLK");
        w.g(8, "0");
    }
    w.g(0, "ENDSEC");
    w.g(0, "SECTION");
    w.g(2, "ENTITIES");
    w.out.push_str(&ents_out.out);
    w.g(0, "ENDSEC");
    w.g(0, "EOF");
    w.out.into_bytes()
}

fn head(w: &mut W, kind: &str, layer: &str, e: &Ent) {
    w.g(0, kind);
    w.g(8, layer);
    if e.by_block {
        w.i(62, 0);
    } else if let Some(c) = e.color {
        w.i(62, nearest_aci(c) as i64);
    }
}

fn poly(w: &mut W, layer: &str, e: &Ent, pts: &[V], closed: bool) {
    head(w, "POLYLINE", layer, e);
    w.i(66, 1);
    w.n(10, 0.0);
    w.n(20, 0.0);
    w.n(30, 0.0);
    w.i(70, if closed { 1 } else { 0 });
    for p in pts {
        w.g(0, "VERTEX");
        w.g(8, layer);
        w.n(10, p.x);
        w.n(20, p.y);
        w.n(30, 0.0);
        if p.b != 0.0 {
            w.n(42, p.b);
        }
    }
    w.g(0, "SEQEND");
    w.g(8, layer);
}

fn text(w: &mut W, layer: &str, e: &Ent, t: &TextData) {
    let lines: Vec<&str> = t.text.split('\n').collect();
    let rad = t.rot * D2R;
    let lh = t.h * 1.6;
    let start_off = if t.mtext {
        let va = t.valign as i32;
        if va == 3 { -t.h } else if va == 2 { (lines.len() as f64 - 1.0) * lh / 2.0 - t.h / 2.0 } else { (lines.len() as f64 - 1.0) * lh }
    } else {
        0.0
    };
    for (i, line) in lines.iter().enumerate() {
        if line.is_empty() {
            continue;
        }
        let off = start_off - i as f64 * lh;
        let (px, py) = (t.p.x - rad.sin() * off, t.p.y + rad.cos() * off);
        head(w, "TEXT", layer, e);
        w.n(10, px);
        w.n(20, py);
        w.n(30, 0.0);
        w.n(40, t.h);
        w.g(1, &esc(line));
        if t.rot != 0.0 {
            w.n(50, t.rot);
        }
        if t.wf != 1.0 {
            w.n(41, t.wf);
        }
        let ha = t.halign as i64;
        let va = if t.mtext { 0 } else { t.valign as i64 };
        if ha != 0 || va != 0 {
            w.i(72, ha);
            w.n(11, px);
            w.n(21, py);
            w.n(31, 0.0);
            if va != 0 {
                w.i(73, va);
            }
        }
    }
}

fn write_ent(w: &mut W, e: &Ent, layer: &str, d: &Drawing, hatch_blocks: &mut Vec<(String, Vec<Ent>)>) {
    match &e.geo {
        Geo::Line { p1, p2 } => {
            head(w, "LINE", layer, e);
            w.n(10, p1.x);
            w.n(20, p1.y);
            w.n(30, 0.0);
            w.n(11, p2.x);
            w.n(21, p2.y);
            w.n(31, 0.0);
        }
        Geo::Poly { pts, closed, filled } => {
            if *filled && (pts.len() == 3 || pts.len() == 4) && pts.iter().all(|v| v.b == 0.0) {
                let q = if pts.len() == 4 { [pts[0], pts[1], pts[3], pts[2]] } else { [pts[0], pts[1], pts[2], pts[2]] };
                head(w, "SOLID", layer, e);
                for (k, p) in q.iter().enumerate() {
                    w.n(10 + k as i32, p.x);
                    w.n(20 + k as i32, p.y);
                    w.n(30 + k as i32, 0.0);
                }
            } else {
                poly(w, layer, e, pts, *closed);
            }
        }
        Geo::Circle { c, r } => {
            head(w, "CIRCLE", layer, e);
            w.n(10, c.x);
            w.n(20, c.y);
            w.n(30, 0.0);
            w.n(40, *r);
        }
        Geo::Arc { c, r, a0, a1 } => {
            head(w, "ARC", layer, e);
            w.n(10, c.x);
            w.n(20, c.y);
            w.n(30, 0.0);
            w.n(40, *r);
            w.n(50, *a0);
            w.n(51, *a1);
        }
        Geo::Ellipse { c, major, ratio, t0, t1 } => {
            let full = ((t1 - t0).rem_euclid(2.0 * std::f64::consts::PI)).abs() < 1e-9;
            let tol = major.x.hypot(major.y) / 400.0;
            let mut pts = ellipse_points(*c, *major, *ratio, *t0, *t1, tol);
            if full {
                pts.pop();
            }
            let v: Vec<V> = pts.into_iter().map(|p| V { x: p.x, y: p.y, b: 0.0 }).collect();
            poly(w, layer, e, &v, full);
        }
        Geo::Text(t) => text(w, layer, e, t),
        Geo::Point { p } => {
            head(w, "POINT", layer, e);
            w.n(10, p.x);
            w.n(20, p.y);
            w.n(30, 0.0);
        }
        Geo::Insert { block, p, sx, sy, rot, cols, rows, cs, rs, attribs } => {
            if d.blocks.contains_key(block) {
                head(w, "INSERT", layer, e);
                w.g(2, &name(block));
                w.n(10, p.x);
                w.n(20, p.y);
                w.n(30, 0.0);
                if *sx != 1.0 {
                    w.n(41, *sx);
                }
                if *sy != 1.0 {
                    w.n(42, *sy);
                }
                if *rot != 0.0 {
                    w.n(50, *rot);
                }
                if *cols > 1 || *rows > 1 {
                    w.i(70, *cols as i64);
                    w.i(71, *rows as i64);
                    w.n(44, *cs);
                    w.n(45, *rs);
                }
            }
            for a in attribs {
                text(w, layer, e, a);
            }
        }
        Geo::Hatch { loops, solid, pattern, .. } => {
            // R12 has no HATCH: emit the fill as a block of SOLIDs / pattern LINEs and insert it
            let polys: Vec<Vec<P>> = loops
                .iter()
                .map(|lp| {
                    let mut pp = poly_points(lp, true, d.tol);
                    pp.pop();
                    pp
                })
                .filter(|p| p.len() >= 3)
                .collect();
            if polys.is_empty() {
                return;
            }
            let base = Ent { layer: 0, color: None, by_block: true, alpha: None, geo: Geo::Point { p: P::default() } };
            let mut parts: Vec<Ent> = Vec::new();
            if *solid {
                triangulate(&polys, &mut |a, b, c| {
                    parts.push(Ent { geo: Geo::Poly { pts: vec![V { x: a.x, y: a.y, b: 0.0 }, V { x: b.x, y: b.y, b: 0.0 }, V { x: c.x, y: c.y, b: 0.0 }], closed: true, filled: true }, ..base.clone() })
                });
            } else if !pattern.is_empty() {
                hatch_lines(&polys, pattern, &mut |a, b| parts.push(Ent { geo: Geo::Line { p1: a, p2: b }, ..base.clone() }));
            } else {
                for pp in &polys {
                    let v: Vec<V> = pp.iter().map(|p| V { x: p.x, y: p.y, b: 0.0 }).collect();
                    parts.push(Ent { geo: Geo::Poly { pts: v, closed: true, filled: false }, ..base.clone() });
                }
            }
            if parts.is_empty() {
                return;
            }
            let bn = format!("OSHATCH_{}", hatch_blocks.len() + 1);
            head(w, "INSERT", layer, e);
            w.g(2, &bn);
            w.n(10, 0.0);
            w.n(20, 0.0);
            w.n(30, 0.0);
            hatch_blocks.push((bn, parts));
        }
    }
}
