//! Drawing store: entities with tombstones, R-tree index, GPU buffers, edits with undo/redo.

use crate::dxf;
use crate::geom::*;
use crate::model::*;
use crate::tess::*;
use rstar::{RTree, RTreeObject, AABB};
use std::collections::{BTreeSet, HashMap};
use std::rc::Rc;

#[derive(Clone, Debug, PartialEq)]
pub struct Item {
    pub id: u32,
    pub env: AABB<[f64; 2]>,
}
impl RTreeObject for Item {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> Self::Envelope {
        self.env
    }
}

/// GPU-ready buffers in drawing order (so fills overlap like in AutoCAD). Positions are f32
/// relative to `origin`; every vertex carries a packed colour and its visibility layer, so layer
/// colour / opacity / visibility are applied by the renderer without rebuilding anything.
#[derive(Default)]
pub struct Buffers {
    /// chunks: positions (x,y per vertex), packed colours, layer index per vertex.
    /// Uploaded to the GPU one by one, so no full-size concatenated copy is ever built.
    pub chunks: Vec<(Vec<f32>, Vec<u32>, Vec<u16>)>,
    /// [kind(0 lines / 1 tris), 0, first vertex (within kind), vertex count, chunk index] per chunk
    pub groups: Vec<u32>,
    /// total vertices per kind
    pub total: [u32; 2],
}

#[derive(Clone, Copy)]
struct Range {
    kind: u8,
    start: u32,
    count: u32,
}

pub struct TextOut {
    pub t: TextData,
    pub rgb: Option<u32>,
    pub layer: u32,
    pub alpha: Option<u8>,
}

/// vertices per chunk before a new one is started (only between entities)
const CHUNK: usize = 1 << 21;

struct Stream {
    done: Vec<(Vec<f32>, Vec<u32>, Vec<u16>)>,
    cur: (Vec<f32>, Vec<u32>, Vec<u16>),
    /// vertices in finished chunks
    base: u32,
}
impl Stream {
    fn new() -> Self {
        Stream { done: Vec::new(), cur: (Vec::new(), Vec::new(), Vec::new()), base: 0 }
    }
    fn len(&self) -> u32 {
        self.base + self.cur.1.len() as u32
    }
    /// called between entities
    fn maybe_cut(&mut self) {
        if self.cur.1.len() >= CHUNK {
            let c = std::mem::replace(&mut self.cur, (Vec::new(), Vec::new(), Vec::new()));
            self.base += c.1.len() as u32;
            self.done.push(c);
        }
    }
}

/// Sink that keeps primitives in drawing order and tracks per-entity ranges
struct LayerSink {
    origin: P,
    s: [Stream; 2],
    texts: Vec<TextOut>,
}
fn resolve(c: CMode, l: LMode) -> (u32, Option<u32>) {
    let layer = match l {
        LMode::Own(x) => x,
        LMode::Inherit => 0,
    };
    let rgb = match c {
        CMode::Rgb(v) => Some(v),
        CMode::Layer(_) => None, // colour from a different layer than visibility: rare, treat as ByLayer
        CMode::Inherit => None,
        CMode::ByBlock => Some(0xffffff),
    };
    (layer, rgb)
}
/// top level: ByBlock opacity means opaque
#[inline]
fn top_alpha(a: Al) -> Al {
    match a {
        Some(0) => Some(255),
        a => a,
    }
}
/// Vertex colour, bytes in memory r, g, b, a:
///  explicit colour  -> r, g, b, opacity (1..=255)
///  ByLayer colour   -> a = 0; then g = 1 marks an own opacity stored in r, otherwise the layer opacity is used
#[inline]
fn pack(rgb: Option<u32>, alpha: Al) -> u32 {
    let alpha = top_alpha(alpha);
    match rgb {
        Some(v) => ((v >> 16) & 255) | (((v >> 8) & 255) << 8) | ((v & 255) << 16) | ((alpha.unwrap_or(255).max(1) as u32) << 24),
        None => match alpha {
            Some(a) => (a as u32) | (1 << 8),
            None => 0,
        },
    }
}
impl LayerSink {
    fn new(origin: P) -> Self {
        LayerSink { origin, s: [Stream::new(), Stream::new()], texts: Vec::new() }
    }
    /// vertex counts per kind, to compute an entity's ranges
    fn mark(&self) -> [u32; 2] {
        [self.s[0].len(), self.s[1].len()]
    }
    fn between_entities(&mut self) {
        self.s[0].maybe_cut();
        self.s[1].maybe_cut();
    }
}
impl Emit for LayerSink {
    fn line(&mut self, a: P, b: P, c: CMode, l: LMode, al: Al) {
        let (layer, rgb) = resolve(c, l);
        let o = self.origin;
        let (v, col, lay) = &mut self.s[0].cur;
        v.extend_from_slice(&[(a.x - o.x) as f32, (a.y - o.y) as f32, (b.x - o.x) as f32, (b.y - o.y) as f32]);
        let pc = pack(rgb, al);
        col.extend_from_slice(&[pc, pc]);
        let li = layer.min(65535) as u16;
        lay.extend_from_slice(&[li, li]);
    }
    fn tri(&mut self, a: P, b: P, cc: P, c: CMode, l: LMode, al: Al) {
        let (layer, rgb) = resolve(c, l);
        let o = self.origin;
        let (v, col, lay) = &mut self.s[1].cur;
        v.extend_from_slice(&[(a.x - o.x) as f32, (a.y - o.y) as f32, (b.x - o.x) as f32, (b.y - o.y) as f32, (cc.x - o.x) as f32, (cc.y - o.y) as f32]);
        let pc = pack(rgb, al);
        col.extend_from_slice(&[pc, pc, pc]);
        let li = layer.min(65535) as u16;
        lay.extend_from_slice(&[li, li, li]);
    }
    fn text(&mut self, t: TextData, c: CMode, l: LMode, al: Al) {
        let (layer, rgb) = resolve(c, l);
        self.texts.push(TextOut { t, rgb, layer, alpha: top_alpha(al) });
    }
}
impl LayerSink {
    fn finish(self) -> (Buffers, Vec<TextOut>) {
        let mut b = Buffers::default();
        for (kind, st) in self.s.into_iter().enumerate() {
            let mut all = st.done;
            all.push(st.cur);
            for (mut v, mut c, mut l) in all {
                if c.is_empty() {
                    continue;
                }
                v.shrink_to_fit();
                c.shrink_to_fit();
                l.shrink_to_fit();
                let start = b.total[kind];
                b.groups.extend_from_slice(&[kind as u32, 0, start, c.len() as u32, b.chunks.len() as u32]);
                b.total[kind] += c.len() as u32;
                b.chunks.push((v, c, l));
            }
        }
        (b, self.texts)
    }
}

pub struct Change {
    ents: Vec<(u32, Option<Ent>)>,
    layers: Option<Vec<Layer>>,
}

pub struct Drawing {
    pub layers: Layers,
    pub blocks: HashMap<String, Block>,
    pub ents: Vec<Option<Ent>>,
    pub bbs: Vec<Option<BB>>,
    tree: RTree<Item>,
    cache: HashMap<String, Option<Rc<BlockTess>>>,
    pub tol: f64,
    pub origin: P,
    pub base: Buffers,
    ranges: Vec<Vec<Range>>,
    in_base: Vec<bool>,
    dirty: BTreeSet<u32>,
    hide: Vec<u32>,
    pub overlay: Buffers,
    texts: HashMap<u32, Vec<TextOut>>,
    history: Vec<Change>,
    future: Vec<Change>,
    pub skipped: usize,
    pub sel: Vec<f32>,
}

impl Default for Drawing {
    fn default() -> Self {
        let mut layers = Layers::default();
        layers.get_or_add("0", 0xffffff);
        Drawing {
            layers,
            blocks: HashMap::new(),
            ents: Vec::new(),
            bbs: Vec::new(),
            tree: RTree::new(),
            cache: HashMap::new(),
            tol: 0.01,
            origin: P::default(),
            base: Buffers::default(),
            ranges: Vec::new(),
            in_base: Vec::new(),
            dirty: BTreeSet::new(),
            hide: Vec::new(),
            overlay: Buffers::default(),
            texts: HashMap::new(),
            history: Vec::new(),
            future: Vec::new(),
            skipped: 0,
            sel: Vec::new(),
        }
    }
}

fn env(bb: &BB) -> AABB<[f64; 2]> {
    AABB::from_corners([bb.x1, bb.y1], [bb.x2, bb.y2])
}

impl Drawing {
    pub fn from_dxf(bytes: &[u8]) -> Result<Drawing, String> {
        let text = dxf::decode(bytes)?;
        let p = dxf::parse(&text);
        let mut d = Drawing { layers: p.layers, blocks: p.blocks, skipped: p.skipped, ..Default::default() };
        d.ents = p.ents.into_iter().map(Some).collect();
        d.reindex();
        d.choose_origin();
        Ok(d)
    }

    // ------------------------------------------------------------ bounding boxes & index
    pub fn ent_bb(&mut self, e: &Ent) -> Option<BB> {
        let mut bb = BB::EMPTY;
        match &e.geo {
            Geo::Insert { block, p, sx, sy, rot, cols, rows, cs, rs, attribs } => {
                let tol = self.tol;
                let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
                if let Some(bt) = t.block(block, 0) {
                    if bt.bb.valid() {
                        let base = self.blocks.get(block.as_str()).map(|b| b.base).unwrap_or_default();
                        let (sn, co) = (rot * D2R).sin_cos();
                        for (ci, ri) in [(0, 0), (cols.saturating_sub(1), 0), (0, rows.saturating_sub(1)), (cols.saturating_sub(1), rows.saturating_sub(1))] {
                            let (ox, oy) = (ci as f64 * cs, ri as f64 * rs);
                            let ip = P::new(p.x + ox * co - oy * sn, p.y + ox * sn + oy * co);
                            let m = M::insert(ip, *rot, *sx, *sy, base);
                            for q in bt.bb.corners() {
                                bb.add(m.ap(q));
                            }
                        }
                    }
                }
                for a in attribs {
                    text_box(a).iter().for_each(|q| bb.add(*q));
                }
                if !bb.valid() {
                    bb.add(*p);
                }
            }
            Geo::Poly { pts, closed, .. } if pts.iter().any(|v| v.b != 0.0) => {
                poly_points(pts, *closed, self.tol).iter().for_each(|q| bb.add(*q));
            }
            Geo::Arc { c, r, a0, a1 } => arc_points(*c, *r, *a0, *a1, self.tol.max(r * 0.002)).iter().for_each(|q| bb.add(*q)),
            Geo::Ellipse { c, major, ratio, t0, t1 } => ellipse_points(*c, *major, *ratio, *t0, *t1, self.tol).iter().for_each(|q| bb.add(*q)),
            Geo::Hatch { loops, .. } => {
                for lp in loops {
                    poly_points(lp, true, self.tol).iter().for_each(|q| bb.add(*q));
                }
            }
            g => coarse_bb(g, &mut bb),
        }
        if bb.valid() { Some(bb) } else { None }
    }

    fn reindex(&mut self) {
        let mut items = Vec::with_capacity(self.ents.len());
        self.bbs = Vec::with_capacity(self.ents.len());
        let ents = std::mem::take(&mut self.ents);
        for (i, e) in ents.iter().enumerate() {
            let bb = e.as_ref().and_then(|e| self.ent_bb(e));
            if let Some(b) = &bb {
                items.push(Item { id: i as u32, env: env(b) });
            }
            self.bbs.push(bb);
        }
        self.ents = ents;
        self.tree = RTree::bulk_load(items);
    }

    /// Does this entity count for "zoom extents"? An INSERT of an empty or missing block has only a
    /// point box at its insertion point; AutoCAD ignores those, and in real files they are often
    /// scattered hundreds of kilometres away, which made the whole drawing a dot.
    fn counts_for_extents(e: &Ent, b: &BB) -> bool {
        !(matches!(e.geo, Geo::Insert { .. }) && b.x2 - b.x1 == 0.0 && b.y2 - b.y1 == 0.0)
    }
    /// Plain extents of everything (used for editing maths)
    pub fn extents(&self, visible_only: bool) -> BB {
        let mut bb = BB::EMPTY;
        for (i, b) in self.bbs.iter().enumerate() {
            if let (Some(b), Some(e)) = (b, &self.ents[i]) {
                if (!visible_only || self.layers.visible(e.layer)) && Self::counts_for_extents(e, b) {
                    bb.union(b);
                }
            }
        }
        if !bb.valid() {
            // nothing but empty inserts: fall back to their points
            for (i, b) in self.bbs.iter().enumerate() {
                if let (Some(b), Some(e)) = (b, &self.ents[i]) {
                    if !visible_only || self.layers.visible(e.layer) { bb.union(b); }
                }
            }
        }
        bb
    }
    /// Extents of everything drawn on a layer, including the contents of blocks (a whole plan is
    /// often one inserted block whose parts sit on their own layers).
    pub fn layer_extents(&mut self, layer: u32) -> BB {
        let mut bb = BB::EMPTY;
        let tol = self.tol;
        let mut per_block: HashMap<String, Option<(BB, BB)>> = HashMap::new(); // (own layer, layer-0/inherit) boxes
        let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
        for (i, e) in self.ents.iter().enumerate() {
            let Some(e) = e else { continue };
            if e.layer == layer {
                if let Some(b) = &self.bbs[i] {
                    bb.union(b);
                }
                continue;
            }
            if let Geo::Insert { block, p, sx, sy, rot, cols, rows, cs, rs, .. } = &e.geo {
                let entry = per_block.entry(block.clone()).or_insert_with(|| {
                    let bt = t.block(block, 0)?;
                    let (mut own, inh) = (BB::EMPTY, BB::EMPTY);
                    for (k, sg) in bt.segs.iter().enumerate() {
                        if bt.seg_m[k].1 == LMode::Own(layer) {
                            own.add(P::new(sg[0], sg[1]));
                            own.add(P::new(sg[2], sg[3]));
                        }
                    }
                    for (k, tr) in bt.tris.iter().enumerate() {
                        if bt.tri_m[k].1 == LMode::Own(layer) {
                            own.add(P::new(tr[0], tr[1]));
                            own.add(P::new(tr[2], tr[3]));
                            own.add(P::new(tr[4], tr[5]));
                        }
                    }
                    for (tx, _, l, _) in &bt.texts {
                        if *l == LMode::Own(layer) {
                            text_box(tx).iter().for_each(|q| own.add(*q));
                        }
                    }
                    if own.valid() { Some((own, inh)) } else { None }
                });
                if let Some((own, _)) = entry {
                    let base = self.blocks.get(block.as_str()).map(|b| b.base).unwrap_or_default();
                    let (sn, co) = (rot * D2R).sin_cos();
                    for (ci, ri) in [(0, 0), (cols.saturating_sub(1), 0), (0, rows.saturating_sub(1)), (cols.saturating_sub(1), rows.saturating_sub(1))] {
                        let (ox, oy) = (ci as f64 * cs, ri as f64 * rs);
                        let ip = P::new(p.x + ox * co - oy * sn, p.y + ox * sn + oy * co);
                        let m = M::insert(ip, *rot, *sx, *sy, base);
                        for q in own.corners() {
                            bb.add(m.ap(q));
                        }
                    }
                }
            }
        }
        bb
    }
    pub fn ids_extents(&self, ids: &[u32]) -> BB {
        let mut bb = BB::EMPTY;
        for &i in ids {
            if let (Some(Some(b)), Some(Some(_))) = (self.bbs.get(i as usize), self.ents.get(i as usize)) {
                bb.union(b);
            }
        }
        bb
    }
    /// Extents for the view: like `extents`, but a handful of stray objects lying far away from
    /// the rest of the drawing (less than 0.5 % of them) are left out. Returns (box, how many were left out).
    pub fn view_extents(&self, visible_only: bool) -> (BB, usize) {
        let full = self.extents(visible_only);
        let mut items: Vec<(f64, f64, usize)> = Vec::new();
        for (i, b) in self.bbs.iter().enumerate() {
            if let (Some(b), Some(e)) = (b, &self.ents[i]) {
                if (!visible_only || self.layers.visible(e.layer)) && Self::counts_for_extents(e, b) {
                    items.push(((b.x1 + b.x2) / 2.0, (b.y1 + b.y2) / 2.0, i));
                }
            }
        }
        let n = items.len();
        if n < 20 || !full.valid() {
            return (full, 0);
        }
        let q = |mut v: Vec<f64>| -> (f64, f64) {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let k = (v.len() as f64 * 0.01) as usize;
            (v[k], v[v.len() - 1 - k])
        };
        let (x1, x2) = q(items.iter().map(|t| t.0).collect());
        let (y1, y2) = q(items.iter().map(|t| t.1).collect());
        let (w, h) = ((x2 - x1).max(1e-9), (y2 - y1).max(1e-9));
        let size = w.max(h);
        let (lx1, lx2, ly1, ly2) = (x1 - 2.0 * size, x2 + 2.0 * size, y1 - 2.0 * size, y2 + 2.0 * size);
        let mut core = BB::EMPTY;
        let mut out = 0usize;
        for &(cx, cy, i) in &items {
            if cx < lx1 || cx > lx2 || cy < ly1 || cy > ly2 {
                out += 1;
            } else if let Some(b) = &self.bbs[i] {
                core.union(b);
            }
        }
        let allowed = ((n as f64) * 0.005).ceil() as usize;
        if out == 0 || out > allowed.max(1) || !core.valid() || core.diag() * 5.0 > full.diag() {
            (full, 0)
        } else {
            (core, out)
        }
    }
    fn choose_origin(&mut self) {
        let bb = self.view_extents(false).0;
        if bb.valid() {
            self.origin = P::new(((bb.x1 + bb.x2) / 2.0).round(), ((bb.y1 + bb.y2) / 2.0).round());
            // tolerance from the spread of entity centres, so one huge outlier (e.g. a block inserted at
            // scale 3000) does not make every curve coarse
            let mut cb = BB::EMPTY;
            for (i, b) in self.bbs.iter().enumerate() {
                if let (Some(b), Some(e)) = (b, &self.ents[i]) {
                    let c = P::new((b.x1 + b.x2) / 2.0, (b.y1 + b.y2) / 2.0);
                    if Self::counts_for_extents(e, b) && c.x >= bb.x1 && c.x <= bb.x2 && c.y >= bb.y1 && c.y <= bb.y2 {
                        cb.add(c);
                    }
                }
            }
            let d = if cb.diag() > 0.0 { cb.diag() } else { bb.diag() };
            self.tol = (d / 20000.0).max(1e-6);
        } else {
            self.origin = P::default();
            self.tol = 0.01;
        }
    }

    // ------------------------------------------------------------ GPU buffers
    pub fn build_base(&mut self) {
        let mut sink = LayerSink::new(self.origin);
        let mut ranges: Vec<Vec<Range>> = Vec::with_capacity(self.ents.len());
        let mut texts: HashMap<u32, Vec<TextOut>> = HashMap::new();
        let tol = self.tol;
        {
            let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
            for (i, e) in self.ents.iter().enumerate() {
                sink.between_entities();
                let m0 = sink.mark();
                let tstart = sink.texts.len();
                if let Some(e) = e {
                    let (c, l) = modes(e, false);
                    t.ent_geo(&e.geo, &M::ID, c, l, e.alpha, &mut sink, 0);
                }
                let m1 = sink.mark();
                let mut r = Vec::new();
                for k in 0..2 {
                    if m1[k] > m0[k] {
                        r.push(Range { kind: k as u8, start: m0[k], count: m1[k] - m0[k] });
                    }
                }
                ranges.push(r);
                if sink.texts.len() > tstart {
                    texts.insert(i as u32, sink.texts.drain(tstart..).collect());
                }
            }
        }
        let (buf, _) = sink.finish();
        self.ranges = ranges;
        self.base = buf;
        self.in_base = vec![true; self.ents.len()];
        self.texts = texts;
        self.dirty.clear();
        self.hide.clear();
        self.overlay = Buffers::default();
    }

    /// Tessellate entities changed since the last base build
    pub fn build_overlay(&mut self) {
        let mut sink = LayerSink::new(self.origin);
        let tol = self.tol;
        let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
        for &i in &self.dirty {
            if let Some(Some(e)) = self.ents.get(i as usize) {
                let (c, l) = modes(e, false);
                t.ent_geo(&e.geo, &M::ID, c, l, e.alpha, &mut sink, 0);
            }
        }
        let (buf, _) = sink.finish();
        self.overlay = buf;
    }
    pub fn take_hidden(&mut self) -> Vec<u32> {
        std::mem::take(&mut self.hide)
    }
    pub fn dirty_count(&self) -> usize {
        self.dirty.len()
    }

    fn mark(&mut self, i: u32) {
        let iu = i as usize;
        if iu < self.in_base.len() && self.in_base[iu] {
            self.in_base[iu] = false;
            for r in &self.ranges[iu] {
                self.hide.extend_from_slice(&[r.kind as u32, r.start, r.count]);
            }
        }
        self.dirty.insert(i);
        // texts of this entity
        self.texts.remove(&i);
        if let Some(Some(e)) = self.ents.get(iu) {
            let mut sink = LayerSink::new(self.origin);
            let tol = self.tol;
            let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
            let (c, l) = modes(e, false);
            // only texts are needed: cheap for non-text entities
            if matches!(e.geo, Geo::Text(_) | Geo::Insert { .. }) {
                t.ent_geo(&e.geo, &M::ID, c, l, e.alpha, &mut sink, 0);
                if !sink.texts.is_empty() {
                    self.texts.insert(i, sink.texts);
                }
            }
        }
    }

    pub fn texts_flat(&self) -> (Vec<f64>, String) {
        let mut f = Vec::new();
        let mut s = String::new();
        let mut keys: Vec<&u32> = self.texts.keys().collect();
        keys.sort_unstable();
        for k in keys {
            if self.ents.get(*k as usize).map(|e| e.is_none()).unwrap_or(true) {
                continue;
            }
            for t in &self.texts[k] {
                let d = &t.t;
                f.extend_from_slice(&[d.p.x, d.p.y, d.h, d.rot, d.halign, d.valign, if d.mtext { 1.0 } else { 0.0 }, d.wf, t.layer as f64, t.rgb.map(|v| v as f64).unwrap_or(-1.0), t.alpha.map(|a| a as f64).unwrap_or(-1.0)]);
                if !s.is_empty() || !f.is_empty() {
                    s.push('\u{1}');
                }
                s.push_str(&d.text);
            }
        }
        if s.starts_with('\u{1}') {
            s.remove(0);
        }
        (f, s)
    }

    /// Selection highlight geometry (lines only), relative to origin
    pub fn build_sel(&mut self, ids: &[u32], max_segments: usize) -> usize {
        struct S {
            v: Vec<f32>,
            o: P,
            max: usize,
        }
        impl Emit for S {
            fn line(&mut self, a: P, b: P, _: CMode, _: LMode, _: Al) {
                if self.v.len() / 4 < self.max {
                    self.v.extend_from_slice(&[(a.x - self.o.x) as f32, (a.y - self.o.y) as f32, (b.x - self.o.x) as f32, (b.y - self.o.y) as f32]);
                }
            }
            fn tri(&mut self, a: P, b: P, c: P, cm: CMode, l: LMode, al: Al) {
                self.line(a, b, cm, l, al);
                self.line(b, c, cm, l, al);
                self.line(c, a, cm, l, al);
            }
            fn text(&mut self, t: TextData, cm: CMode, l: LMode, al: Al) {
                let q = text_box(&t);
                for k in 0..4 {
                    self.line(q[k], q[(k + 1) % 4], cm, l, al);
                }
            }
        }
        let mut s = S { v: Vec::new(), o: self.origin, max: max_segments };
        let tol = self.tol;
        let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
        for &i in ids {
            if s.v.len() / 4 >= max_segments {
                break;
            }
            if let Some(Some(e)) = self.ents.get(i as usize) {
                t.ent_geo(&e.geo, &M::ID, CMode::Rgb(0), LMode::Own(0), None, &mut s, 0);
            }
        }
        self.sel = s.v;
        self.sel.len() / 4
    }

    /// world-space segments of one layer (thick ink overlay)
    pub fn layer_segments(&mut self, layer: u32) -> Vec<f64> {
        struct S {
            v: Vec<f64>,
        }
        impl Emit for S {
            fn line(&mut self, a: P, b: P, _: CMode, _: LMode, _: Al) {
                self.v.extend_from_slice(&[a.x, a.y, b.x, b.y]);
            }
            fn tri(&mut self, _: P, _: P, _: P, _: CMode, _: LMode, _: Al) {}
            fn text(&mut self, _: TextData, _: CMode, _: LMode, _: Al) {}
        }
        let mut s = S { v: Vec::new() };
        let tol = self.tol;
        let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol };
        for e in self.ents.iter().flatten() {
            if e.layer == layer {
                t.ent_geo(&e.geo, &M::ID, CMode::Rgb(0), LMode::Own(0), None, &mut s, 0);
            }
        }
        s.v
    }

    // ------------------------------------------------------------ editing
    fn set_ent(&mut self, i: u32, val: Option<Ent>) -> Option<Ent> {
        let iu = i as usize;
        while self.ents.len() <= iu {
            self.ents.push(None);
            self.bbs.push(None);
            self.ranges.push(Vec::new());
            self.in_base.push(false);
        }
        if let Some(b) = self.bbs[iu].take() {
            self.tree.remove(&Item { id: i, env: env(&b) });
        }
        let old = std::mem::replace(&mut self.ents[iu], val);
        if let Some(e) = self.ents[iu].clone() {
            if let Some(b) = self.ent_bb(&e) {
                self.tree.insert(Item { id: i, env: env(&b) });
                self.bbs[iu] = Some(b);
            }
        }
        self.mark(i);
        old
    }
    fn apply(&mut self, ch: Change) -> Change {
        let mut inv = Change { ents: Vec::with_capacity(ch.ents.len()), layers: None };
        if let Some(l) = ch.layers {
            inv.layers = Some(std::mem::replace(&mut self.layers.list, l));
            self.layers.rebuild_map();
        }
        for (i, v) in ch.ents.into_iter().rev() {
            let old = self.set_ent(i, v);
            inv.ents.push((i, old));
        }
        inv
    }
    /// commit a change set: values are the NEW contents
    pub fn commit(&mut self, ents: Vec<(u32, Option<Ent>)>, layers: Option<Vec<Layer>>) {
        let inv = self.apply(Change { ents, layers });
        self.history.push(inv);
        if self.history.len() > 300 {
            self.history.remove(0);
        }
        self.future.clear();
    }
    pub fn undo(&mut self) -> bool {
        match self.history.pop() {
            Some(ch) => {
                let inv = self.apply(ch);
                self.future.push(inv);
                true
            }
            None => false,
        }
    }
    pub fn redo(&mut self) -> bool {
        match self.future.pop() {
            Some(ch) => {
                let inv = self.apply(ch);
                self.history.push(inv);
                true
            }
            None => false,
        }
    }
    /// merge the last n history steps into one (e.g. an eraser drag)
    pub fn merge_last(&mut self, n: usize) {
        if n < 2 || self.history.len() < n {
            return;
        }
        let tail: Vec<Change> = self.history.drain(self.history.len() - n..).collect();
        let mut merged = Change { ents: Vec::new(), layers: None };
        // inverse changes: applying `merged` must undo the newest first (apply() walks ents in reverse)
        for ch in tail.into_iter() {
            if merged.layers.is_none() {
                merged.layers = ch.layers;
            }
            let mut e = ch.ents;
            e.reverse();
            merged.ents.splice(0..0, e);
        }
        merged.ents.reverse();
        self.history.push(merged);
    }
    pub fn pick_on_layer(&self, p: P, tol: f64, layer: u32) -> i64 {
        let q = AABB::from_corners([p.x - tol, p.y - tol], [p.x + tol, p.y + tol]);
        let mut best = (-1i64, f64::INFINITY);
        for it in self.tree.locate_in_envelope_intersecting(&q) {
            let Some(e) = &self.ents[it.id as usize] else { continue };
            if e.layer != layer {
                continue;
            }
            let d = self.ent_dist(e, p, 0);
            if d <= tol && d < best.1 {
                best = (it.id as i64, d);
            }
        }
        best.0
    }
    /// Layer of the line / fill under the cursor, looking inside blocks (a whole plan is often one
    /// block). Visible layers only; lines win over fills. Returns the layer index.
    pub fn pick_layer(&mut self, p: P, tol: f64) -> Option<u32> {
        let q = AABB::from_corners([p.x - tol, p.y - tol], [p.x + tol, p.y + tol]);
        let cands: Vec<u32> = self.tree.locate_in_envelope_intersecting(&q).map(|it| it.id).collect();
        let tl = self.tol;
        let mut best: Option<(u32, f64, bool)> = None; // (layer, dist, is_fill)
        let mut consider = |layer: u32, d: f64, fill: bool, best: &mut Option<(u32, f64, bool)>| {
            let better = match best {
                None => true,
                Some((_, bd, bf)) => if fill != *bf { !fill } else { d < *bd },
            };
            if better {
                *best = Some((layer, d, fill));
            }
        };
        // plain entities first (needs &self), then block contents (needs the tessellation cache)
        for &id in &cands {
            let Some(e) = &self.ents[id as usize] else { continue };
            if !self.layers.visible(e.layer) || matches!(e.geo, Geo::Insert { .. }) {
                continue;
            }
            let d = self.ent_dist(e, p, 0);
            if d <= tol {
                consider(e.layer, d, matches!(e.geo, Geo::Hatch { .. }), &mut best);
            }
        }
        let mut t = Tess { blocks: &self.blocks, cache: &mut self.cache, tol: tl };
        for id in cands {
            let Some(e) = &self.ents[id as usize] else { continue };
            if !self.layers.visible(e.layer) {
                continue;
            }
            if let Geo::Insert { block, p: ip, sx, sy, rot, cols, rows, .. } = &e.geo {
                if *cols > 1 || *rows > 1 {
                    if self.layers.visible(e.layer) { consider(e.layer, tol, false, &mut best); }
                    continue;
                }
                let Some(bt) = t.block(block, 0) else { continue };
                let base = self.blocks.get(block.as_str()).map(|b| b.base).unwrap_or_default();
                let m = M::insert(*ip, *rot, *sx, *sy, base);
                let inv = m.inv();
                let lp = inv.ap(p);
                let ltol = tol / m.scale().max(1e-300);
                let lay = |lm: LMode| match lm { LMode::Own(l) => l, LMode::Inherit => e.layer };
                for (k, sg) in bt.segs.iter().enumerate() {
                    let d = seg_dist(lp, P::new(sg[0], sg[1]), P::new(sg[2], sg[3]));
                    if d <= ltol {
                        let l = lay(bt.seg_m[k].1);
                        if self.layers.visible(l) { consider(l, d * m.scale(), false, &mut best); }
                    }
                }
                if best.map(|b| !b.2).unwrap_or(false) {
                    continue;
                }
                for (k, tr) in bt.tris.iter().enumerate() {
                    let tri = [P::new(tr[0], tr[1]), P::new(tr[2], tr[3]), P::new(tr[4], tr[5])];
                    if point_in_poly(lp, &tri) {
                        let l = lay(bt.tri_m[k].1);
                        if self.layers.visible(l) { consider(l, 0.0, true, &mut best); }
                    }
                }
            }
        }
        best.map(|b| b.0)
    }
    pub fn next_id(&self) -> u32 {
        self.ents.len() as u32
    }

    // ------------------------------------------------------------ queries
    pub fn ent_dist(&self, e: &Ent, p: P, depth: u32) -> f64 {
        let tol = self.tol;
        match &e.geo {
            Geo::Line { p1, p2 } => seg_dist(p, *p1, *p2),
            Geo::Poly { pts, closed, filled } => {
                let pp = poly_points(pts, *closed, tol);
                if *filled && point_in_poly(p, &pp) {
                    return 0.0;
                }
                polyline_dist(p, &pp)
            }
            Geo::Circle { c, r } => (dist(p, *c) - r).abs(),
            Geo::Arc { c, r, a0, a1 } => polyline_dist(p, &arc_points(*c, *r, *a0, *a1, tol.max(r * 0.002))),
            Geo::Ellipse { c, major, ratio, t0, t1 } => polyline_dist(p, &ellipse_points(*c, *major, *ratio, *t0, *t1, tol)),
            Geo::Text(t) => {
                let b = text_box(t);
                if point_in_poly(p, &b) { 0.0 } else { polyline_dist(p, &[b[0], b[1], b[2], b[3], b[0]]) }
            }
            Geo::Point { p: q } => dist(p, *q),
            Geo::Insert { block, p: ip, sx, sy, rot, cols, rows, cs, rs, attribs } => {
                let mut best = f64::INFINITY;
                for a in attribs {
                    let b = text_box(a);
                    if point_in_poly(p, &b) {
                        return 0.0;
                    }
                }
                let Some(blk) = self.blocks.get(block.as_str()) else { return best };
                if depth > 6 {
                    return best;
                }
                let (sn, co) = (rot * D2R).sin_cos();
                let sc = (sx * sy).abs().sqrt().max(1e-300);
                for ci in 0..(*cols).min(50) {
                    for ri in 0..(*rows).min(50) {
                        let (ox, oy) = (ci as f64 * cs, ri as f64 * rs);
                        let ipp = P::new(ip.x + ox * co - oy * sn, ip.y + ox * sn + oy * co);
                        let m = M::insert(ipp, *rot, *sx, *sy, blk.base);
                        let q = m.inv().ap(p);
                        for c in &blk.ents {
                            best = best.min(self.ent_dist(c, q, depth + 1) * sc);
                        }
                    }
                }
                best
            }
            Geo::Hatch { loops, solid, .. } => {
                let polys: Vec<Vec<P>> = loops.iter().map(|lp| poly_points(lp, true, tol)).collect();
                let inside = polys.iter().filter(|pp| point_in_poly(p, pp)).count() % 2 == 1;
                if inside && (*solid || true) {
                    return 0.0;
                }
                polys.iter().map(|pp| polyline_dist(p, pp)).fold(f64::INFINITY, f64::min)
            }
        }
    }

    pub fn pick(&self, p: P, tol: f64) -> i64 {
        let q = AABB::from_corners([p.x - tol, p.y - tol], [p.x + tol, p.y + tol]);
        let mut best = (-1i64, f64::INFINITY, false);
        for it in self.tree.locate_in_envelope_intersecting(&q) {
            let Some(e) = &self.ents[it.id as usize] else { continue };
            if !self.layers.visible(e.layer) {
                continue;
            }
            let d = self.ent_dist(e, p, 0);
            // prefer outlines over area fills (hatches) when both are hit
            let is_fill = matches!(e.geo, Geo::Hatch { .. });
            if d <= tol {
                let better = if is_fill != best.2 { !is_fill } else { d < best.1 || (d == best.1 && it.id as i64 > best.0) };
                if best.0 < 0 || better {
                    best = (it.id as i64, d, is_fill);
                }
            }
        }
        best.0
    }

    pub fn select_window(&self, a: P, b: P, crossing: bool) -> Vec<u32> {
        let q = AABB::from_corners([a.x.min(b.x), a.y.min(b.y)], [a.x.max(b.x), a.y.max(b.y)]);
        let mut out: Vec<u32> = if crossing {
            self.tree.locate_in_envelope_intersecting(&q).map(|i| i.id).collect()
        } else {
            self.tree.locate_in_envelope(&q).map(|i| i.id).collect()
        };
        out.retain(|&i| self.ents[i as usize].as_ref().map(|e| self.layers.visible(e.layer)).unwrap_or(false));
        out.sort_unstable();
        out
    }

    /// nearest snap point: returns (x, y, kind) — kind 0 end, 1 mid, 2 centre, 3 insertion
    pub fn snap(&self, p: P, tol: f64, exclude: &[u32]) -> Option<(P, u8)> {
        let q = AABB::from_corners([p.x - tol, p.y - tol], [p.x + tol, p.y + tol]);
        let mut best: Option<(P, u8)> = None;
        let mut bd = tol;
        let mut consider = |c: P, k: u8| {
            let d = dist(c, p);
            if d < bd {
                bd = d;
                best = Some((c, k));
            }
        };
        for it in self.tree.locate_in_envelope_intersecting(&q) {
            if exclude.contains(&it.id) {
                continue;
            }
            let Some(e) = &self.ents[it.id as usize] else { continue };
            if !self.layers.visible(e.layer) {
                continue;
            }
            match &e.geo {
                Geo::Line { p1, p2 } => {
                    consider(*p1, 0);
                    consider(*p2, 0);
                    consider(lerp(*p1, *p2, 0.5), 1);
                }
                Geo::Poly { pts, closed, .. } => {
                    let n = pts.len();
                    for (k, v) in pts.iter().enumerate() {
                        consider(v.p(), 0);
                        if (k + 1 < n || *closed) && v.b == 0.0 {
                            consider(lerp(v.p(), pts[(k + 1) % n].p(), 0.5), 1);
                        }
                    }
                }
                Geo::Circle { c, r } => {
                    consider(*c, 2);
                    for a in [0.0f64, 90.0, 180.0, 270.0] {
                        consider(P::new(c.x + r * (a * D2R).cos(), c.y + r * (a * D2R).sin()), 0);
                    }
                }
                Geo::Arc { c, r, a0, a1 } => {
                    consider(*c, 2);
                    let pts = arc_points(*c, *r, *a0, *a1, r * 2.0);
                    consider(pts[0], 0);
                    consider(*pts.last().unwrap(), 0);
                    let mut am = (a0 + a1) / 2.0;
                    if a1 < a0 {
                        am += 180.0;
                    }
                    consider(P::new(c.x + r * (am * D2R).cos(), c.y + r * (am * D2R).sin()), 1);
                }
                Geo::Ellipse { c, .. } => consider(*c, 2),
                Geo::Text(t) => consider(t.p, 3),
                Geo::Point { p } => consider(*p, 3),
                Geo::Insert { p, .. } => consider(*p, 3),
                Geo::Hatch { loops, .. } => loops.iter().flatten().for_each(|v| consider(v.p(), 0)),
            }
        }
        best
    }

    pub fn alive_count(&self) -> usize {
        self.ents.iter().filter(|e| e.is_some()).count()
    }
}
