//! Tessellation of entities into line segments / triangles / text items,
//! with AutoCAD colour + layer inheritance rules for blocks.

use crate::geom::*;
use crate::model::*;
use std::collections::HashMap;
use std::rc::Rc;

/// Where a primitive's colour comes from
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum CMode {
    Rgb(u32),
    Layer(u32),
    /// ByLayer on layer "0" inside a block: takes the insert's layer colour
    Inherit,
    ByBlock,
}
/// Which layer controls a primitive's visibility
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LMode {
    Own(u32),
    Inherit,
}

#[inline]
pub fn map_c(child: CMode, ins_c: CMode, ins_l: LMode) -> CMode {
    match child {
        CMode::Inherit => match ins_l {
            LMode::Own(l) => CMode::Layer(l),
            LMode::Inherit => CMode::Inherit,
        },
        CMode::ByBlock => ins_c,
        c => c,
    }
}
/// Opacity of a primitive: None = ByLayer, Some(0) = ByBlock, Some(1..=255) = own opacity
pub type Al = Option<u8>;
#[inline]
pub fn map_a(child: Al, ins: Al) -> Al {
    match child {
        Some(0) => ins,
        a => a,
    }
}
#[inline]
pub fn map_l(child: LMode, ins_l: LMode) -> LMode {
    match child {
        LMode::Inherit => ins_l,
        l => l,
    }
}

/// Modes of an entity: `in_block` = it lives inside a block definition
pub fn modes(e: &Ent, in_block: bool) -> (CMode, LMode) {
    let l = if in_block && e.layer == 0 { LMode::Inherit } else { LMode::Own(e.layer) };
    let c = if let Some(rgb) = e.color {
        CMode::Rgb(rgb)
    } else if e.by_block {
        if in_block { CMode::ByBlock } else { CMode::Rgb(0xffffff) }
    } else if in_block && e.layer == 0 {
        CMode::Inherit
    } else {
        CMode::Layer(e.layer)
    };
    (c, l)
}

pub trait Emit {
    fn line(&mut self, a: P, b: P, c: CMode, l: LMode, al: Al);
    fn tri(&mut self, a: P, b: P, c: P, cm: CMode, l: LMode, al: Al);
    fn text(&mut self, t: TextData, c: CMode, l: LMode, al: Al);
}

/// Cached tessellation of a block definition in block coordinates
#[derive(Default)]
pub struct BlockTess {
    pub segs: Vec<[f64; 4]>,
    pub seg_m: Vec<(CMode, LMode, Al)>,
    pub tris: Vec<[f64; 6]>,
    pub tri_m: Vec<(CMode, LMode, Al)>,
    pub texts: Vec<(TextData, CMode, LMode, Al)>,
    pub bb: BB,
}
impl Emit for BlockTess {
    fn line(&mut self, a: P, b: P, c: CMode, l: LMode, al: Al) {
        self.segs.push([a.x, a.y, b.x, b.y]);
        self.seg_m.push((c, l, al));
        self.bb.add(a);
        self.bb.add(b);
    }
    fn tri(&mut self, a: P, b: P, cc: P, c: CMode, l: LMode, al: Al) {
        self.tris.push([a.x, a.y, b.x, b.y, cc.x, cc.y]);
        self.tri_m.push((c, l, al));
        self.bb.add(a);
        self.bb.add(b);
        self.bb.add(cc);
    }
    fn text(&mut self, t: TextData, c: CMode, l: LMode, al: Al) {
        for p in text_box(&t) {
            self.bb.add(p);
        }
        self.texts.push((t, c, l, al));
    }
}

/// Transform a text through a matrix (keeps it readable when mirrored)
pub fn xform_text(t: &TextData, m: &M) -> TextData {
    let mut o = t.clone();
    o.p = m.ap(t.p);
    let s = m.scale();
    o.h = t.h * s;
    let d = m.av(P::new((t.rot * D2R).cos(), (t.rot * D2R).sin()));
    let mut rot = d.y.atan2(d.x) / D2R;
    if m.det() < 0.0 {
        rot += 180.0;
        let ha = t.halign as i32;
        if ha == 0 {
            o.halign = 2.0
        } else if ha == 2 {
            o.halign = 0.0
        }
    }
    o.rot = rot.rem_euclid(360.0);
    o
}

pub struct Tess<'a> {
    pub blocks: &'a HashMap<String, Block>,
    pub cache: &'a mut HashMap<String, Option<Rc<BlockTess>>>,
    /// chord tolerance for top-level geometry (world units)
    pub tol: f64,
}

impl<'a> Tess<'a> {
    pub fn block(&mut self, name: &str, depth: u32) -> Option<Rc<BlockTess>> {
        if let Some(c) = self.cache.get(name) {
            return c.clone();
        }
        let blk = self.blocks.get(name)?;
        if depth > 16 {
            return None;
        }
        self.cache.insert(name.to_string(), None); // cycle guard
        // tolerance relative to the block's own size so it looks the same at any insert scale
        let mut bb = BB::EMPTY;
        for e in &blk.ents {
            coarse_bb(&e.geo, &mut bb);
        }
        let tol = (bb.diag() / 600.0).max(1e-9);
        let mut bt = BlockTess::default();
        let saved = self.tol;
        self.tol = tol;
        for e in &blk.ents {
            let (c, l) = modes(e, true);
            self.ent_geo(&e.geo, &M::ID, c, l, e.alpha, &mut bt, depth + 1);
        }
        self.tol = saved;
        let rc = Rc::new(bt);
        self.cache.insert(name.to_string(), Some(rc.clone()));
        Some(rc)
    }

    fn emit_path(&self, pts: &[P], m: &M, c: CMode, l: LMode, al: Al, out: &mut dyn Emit) {
        if pts.len() == 1 {
            let p = m.ap(pts[0]);
            out.line(p, P::new(p.x + self.tol * 0.01, p.y), c, l, al);
            return;
        }
        let mut prev = m.ap(pts[0]);
        for q in &pts[1..] {
            let cur = m.ap(*q);
            out.line(prev, cur, c, l, al);
            prev = cur;
        }
    }

    pub fn ent_geo(&mut self, g: &Geo, m: &M, c: CMode, l: LMode, al: Al, out: &mut dyn Emit, depth: u32) {
        let s = m.scale().max(1e-300);
        let tol = self.tol / s; // local tolerance
        match g {
            Geo::Line { p1, p2 } => out.line(m.ap(*p1), m.ap(*p2), c, l, al),
            Geo::Poly { pts, closed, filled } => {
                let pp = poly_points(pts, *closed, tol);
                if *filled && pts.len() == 4 && pts.iter().all(|v| v.b == 0.0) {
                    // SOLID/TRACE: AutoCAD fills triangles (1,2,3) and (2,4,3) of the DXF vertex order;
                    // we store the outline as [1,2,4,3], so that is (p0,p1,p3) and (p1,p2,p3) — a crossed
                    // vertex order gives the classic "bow-tie", exactly like AutoCAD.
                    let q: Vec<P> = pts.iter().map(|v| m.ap(v.p())).collect();
                    out.tri(q[0], q[1], q[3], c, l, al);
                    out.tri(q[1], q[2], q[3], c, l, al);
                } else if *filled && pp.len() >= 4 {
                    let poly: Vec<P> = pp[..pp.len() - 1].iter().map(|p| m.ap(*p)).collect();
                    triangulate(&[poly], &mut |a, b, cc| out.tri(a, b, cc, c, l, al));
                } else {
                    self.emit_path(&pp, m, c, l, al, out);
                }
            }
            Geo::Circle { c: cc, r } => self.emit_path(&circle_points(*cc, *r, tol), m, c, l, al, out),
            Geo::Arc { c: cc, r, a0, a1 } => self.emit_path(&arc_points(*cc, *r, *a0, *a1, tol), m, c, l, al, out),
            Geo::Ellipse { c: cc, major, ratio, t0, t1 } => self.emit_path(&ellipse_points(*cc, *major, *ratio, *t0, *t1, tol), m, c, l, al, out),
            Geo::Point { p } => {
                let q = m.ap(*p);
                out.line(q, P::new(q.x + self.tol * 0.01, q.y), c, l, al);
            }
            Geo::Text(t) => out.text(if *m == M::ID { t.clone() } else { xform_text(t, m) }, c, l, al),
            Geo::Insert { block, p, sx, sy, rot, cols, rows, cs, rs, attribs } => {
                if let Some(bt) = self.block(block, depth) {
                    let base = self.blocks.get(block.as_str()).map(|b| b.base).unwrap_or_default();
                    let (sn, co) = (rot * D2R).sin_cos();
                    for ci in 0..(*cols).min(1000) {
                        for ri in 0..(*rows).min(1000) {
                            let (ox, oy) = (ci as f64 * cs, ri as f64 * rs);
                            let ip = P::new(p.x + ox * co - oy * sn, p.y + ox * sn + oy * co);
                            let mi = m.mul(&M::insert(ip, *rot, *sx, *sy, base));
                            for (k, sgm) in bt.segs.iter().enumerate() {
                                let (cm, lm, am) = bt.seg_m[k];
                                out.line(mi.ap(P::new(sgm[0], sgm[1])), mi.ap(P::new(sgm[2], sgm[3])), map_c(cm, c, l), map_l(lm, l), map_a(am, al));
                            }
                            for (k, t) in bt.tris.iter().enumerate() {
                                let (cm, lm, am) = bt.tri_m[k];
                                out.tri(mi.ap(P::new(t[0], t[1])), mi.ap(P::new(t[2], t[3])), mi.ap(P::new(t[4], t[5])), map_c(cm, c, l), map_l(lm, l), map_a(am, al));
                            }
                            for (t, cm, lm, am) in &bt.texts {
                                out.text(xform_text(t, &mi), map_c(*cm, c, l), map_l(*lm, l), map_a(*am, al));
                            }
                        }
                    }
                }
                for a in attribs {
                    out.text(if *m == M::ID { a.clone() } else { xform_text(a, m) }, c, l, al);
                }
            }
            Geo::Hatch { loops, solid, pattern } => {
                let polys: Vec<Vec<P>> = loops
                    .iter()
                    .map(|lp| {
                        let mut pp = poly_points(lp, true, tol);
                        pp.pop();
                        pp.into_iter().map(|p| m.ap(p)).collect::<Vec<P>>()
                    })
                    .filter(|p: &Vec<P>| p.len() >= 3)
                    .collect();
                if polys.is_empty() {
                    return;
                }
                if *solid {
                    triangulate(&polys, &mut |a, b, cc| out.tri(a, b, cc, c, l, al));
                } else if !pattern.is_empty() {
                    let pat: Vec<PatLine> = if *m == M::ID { pattern.clone() } else { pattern.iter().map(|pl| xform_pat(pl, m)).collect() };
                    hatch_lines(&polys, &pat, &mut |a, b| out.line(a, b, c, l, al));
                } else {
                    for poly in &polys {
                        let mut closed = poly.clone();
                        closed.push(poly[0]);
                        self.emit_path(&closed, &M::ID, c, l, al, out);
                    }
                }
            }
        }
    }
}

pub fn xform_pat(pl: &PatLine, m: &M) -> PatLine {
    let b = m.ap(P::new(pl.bx, pl.by));
    let o = m.av(P::new(pl.ox, pl.oy));
    let d = m.av(P::new((pl.ang * D2R).cos(), (pl.ang * D2R).sin()));
    let s = m.scale();
    PatLine { ang: d.y.atan2(d.x) / D2R, bx: b.x, by: b.y, ox: o.x, oy: o.y, dashes: pl.dashes.iter().map(|x| x * s).collect() }
}

/// Coarse bounding box without tessellation detail (used for tolerances)
pub fn coarse_bb(g: &Geo, bb: &mut BB) {
    match g {
        Geo::Line { p1, p2 } => {
            bb.add(*p1);
            bb.add(*p2)
        }
        Geo::Poly { pts, .. } => pts.iter().for_each(|v| bb.add(v.p())),
        Geo::Circle { c, r } | Geo::Arc { c, r, .. } => {
            bb.add(P::new(c.x - r, c.y - r));
            bb.add(P::new(c.x + r, c.y + r))
        }
        Geo::Ellipse { c, major, .. } => {
            let r = major.x.hypot(major.y);
            bb.add(P::new(c.x - r, c.y - r));
            bb.add(P::new(c.x + r, c.y + r))
        }
        Geo::Text(t) => text_box(t).iter().for_each(|p| bb.add(*p)),
        Geo::Point { p } => bb.add(*p),
        Geo::Insert { p, .. } => bb.add(*p),
        Geo::Hatch { loops, .. } => loops.iter().flatten().for_each(|v| bb.add(v.p())),
    }
}

/// Triangulate polygons with holes (even-odd nesting) via earcut
pub fn triangulate(polys: &[Vec<P>], emit: &mut dyn FnMut(P, P, P)) {
    if polys.len() == 1 {
        let poly = &polys[0];
        if poly.len() == 3 {
            emit(poly[0], poly[1], poly[2]);
            return;
        }
        ear(&[poly], emit);
        return;
    }
    // nesting depth of each loop
    let depth: Vec<usize> = polys
        .iter()
        .enumerate()
        .map(|(i, p)| polys.iter().enumerate().filter(|(j, q)| *j != i && point_in_poly(p[0], q)).count())
        .collect();
    for (i, outer) in polys.iter().enumerate() {
        if depth[i] % 2 != 0 {
            continue;
        }
        let holes: Vec<&Vec<P>> = polys
            .iter()
            .enumerate()
            .filter(|(j, h)| depth[*j] == depth[i] + 1 && point_in_poly(h[0], outer))
            .map(|(_, h)| h)
            .collect();
        let mut rings: Vec<&Vec<P>> = vec![outer];
        rings.extend(holes);
        ear(&rings, emit);
    }
}
fn ear(rings: &[&Vec<P>], emit: &mut dyn FnMut(P, P, P)) {
    let mut data: Vec<[f64; 2]> = Vec::new();
    let mut holes: Vec<u32> = Vec::new();
    for (k, r) in rings.iter().enumerate() {
        if k > 0 {
            holes.push(data.len() as u32);
        }
        data.extend(r.iter().map(|p| [p.x, p.y]));
    }
    let mut tris: Vec<u32> = Vec::new();
    let mut ec = earcut::Earcut::new();
    ec.earcut(data.iter().copied(), &holes, &mut tris);
    for t in tris.chunks_exact(3) {
        let g = |i: u32| P::new(data[i as usize][0], data[i as usize][1]);
        emit(g(t[0]), g(t[1]), g(t[2]));
    }
}

/// Pattern hatch lines clipped to polygons (even-odd), with dashes
pub fn hatch_lines(polys: &[Vec<P>], pattern: &[PatLine], emit: &mut dyn FnMut(P, P)) {
    let mut bb = BB::EMPTY;
    polys.iter().flatten().for_each(|p| bb.add(*p));
    if !bb.valid() {
        return;
    }
    let mut budget: i64 = 60_000;
    for pl in pattern {
        let (s, c) = (pl.ang * D2R).sin_cos();
        let u = P::new(c, s); // line direction
        let nrm = P::new(-s, c); // normal
        let spacing = pl.ox * nrm.x + pl.oy * nrm.y;
        if spacing.abs() < 1e-12 {
            continue;
        }
        let shift = pl.ox * u.x + pl.oy * u.y;
        let proj = |p: P| p.x * nrm.x + p.y * nrm.y;
        let c0 = pl.bx * nrm.x + pl.by * nrm.y;
        let cs: Vec<f64> = bb.corners().iter().map(|p| proj(*p)).collect();
        let (cmin, cmax) = (cs.iter().cloned().fold(f64::INFINITY, f64::min), cs.iter().cloned().fold(f64::NEG_INFINITY, f64::max));
        let (mut k0, mut k1) = (((cmin - c0) / spacing).floor() as i64, ((cmax - c0) / spacing).ceil() as i64);
        if k0 > k1 {
            std::mem::swap(&mut k0, &mut k1);
        }
        let count = k1 - k0 + 1;
        // too dense for the budget: thin the family out
        let step = ((count as f64 / 4000.0).ceil() as i64).max(1);
        let period: f64 = pl.dashes.iter().map(|d| d.abs()).sum();
        let mut k = k0;
        while k <= k1 && budget > 0 {
            let o = P::new(pl.bx + pl.ox * k as f64, pl.by + pl.oy * k as f64);
            // intersections of line o + t*u with all edges
            let mut ts: Vec<f64> = Vec::new();
            for poly in polys {
                let n = poly.len();
                for i in 0..n {
                    let a = poly[i];
                    let b = poly[(i + 1) % n];
                    let (da, db) = (proj(a) - proj(o), proj(b) - proj(o));
                    if (da > 0.0) != (db > 0.0) {
                        let t = da / (da - db);
                        let x = P::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                        ts.push((x.x - o.x) * u.x + (x.y - o.y) * u.y);
                    }
                }
            }
            ts.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for pair in ts.chunks_exact(2) {
                let (t0, t1) = (pair[0], pair[1]);
                if period <= 0.0 || pl.dashes.is_empty() {
                    emit(P::new(o.x + u.x * t0, o.y + u.y * t0), P::new(o.x + u.x * t1, o.y + u.y * t1));
                    budget -= 1;
                    continue;
                }
                // dash phase: the pattern starts at the line origin, shifted by k*shift
                let phase0 = (k as f64 * shift).rem_euclid(period);
                let mut t = t0;
                // position within period at t0
                let mut pos = (t0 + phase0).rem_euclid(period);
                let mut di = 0;
                let mut acc = 0.0;
                while di < pl.dashes.len() && acc + pl.dashes[di].abs() <= pos {
                    acc += pl.dashes[di].abs();
                    di += 1;
                }
                let mut guard = 0;
                while t < t1 && guard < 10_000 && budget > 0 {
                    guard += 1;
                    let d = pl.dashes[di % pl.dashes.len()];
                    let remaining = acc + d.abs() - pos;
                    let te = (t + remaining.max(1e-12)).min(t1);
                    if d > 0.0 {
                        emit(P::new(o.x + u.x * t, o.y + u.y * t), P::new(o.x + u.x * te, o.y + u.y * te));
                        budget -= 1;
                    } else if d == 0.0 {
                        let e = (t1 - t0).abs() * 1e-4;
                        emit(P::new(o.x + u.x * t, o.y + u.y * t), P::new(o.x + u.x * (t + e), o.y + u.y * (t + e)));
                        budget -= 1;
                    }
                    t = te;
                    acc += d.abs();
                    pos = acc;
                    di += 1;
                    if di % pl.dashes.len() == 0 {
                        acc = 0.0;
                        pos = 0.0;
                    }
                }
            }
            k += step;
        }
    }
}
