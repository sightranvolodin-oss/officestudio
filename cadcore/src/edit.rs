//! Similarity transforms (move / rotate / uniform scale / mirror) of entities.

use crate::geom::*;
use crate::model::*;

fn xt(t: &TextData, m: &M) -> TextData {
    let mut o = t.clone();
    o.p = m.ap(t.p);
    o.h = t.h * m.scale();
    if m.det() >= 0.0 {
        let d = m.av(P::new((t.rot * D2R).cos(), (t.rot * D2R).sin()));
        o.rot = (d.y.atan2(d.x) / D2R).rem_euclid(360.0);
    }
    // mirrored: keep text readable (like AutoCAD MIRRTEXT=0) — position moves, orientation stays
    o
}

pub fn xform(g: &Geo, m: &M) -> Geo {
    let s = m.scale();
    let refl = m.det() < 0.0;
    let ang = |deg: f64| -> f64 {
        let d = m.av(P::new((deg * D2R).cos(), (deg * D2R).sin()));
        d.y.atan2(d.x) / D2R
    };
    match g {
        Geo::Line { p1, p2 } => Geo::Line { p1: m.ap(*p1), p2: m.ap(*p2) },
        Geo::Poly { pts, closed, filled } => Geo::Poly {
            pts: pts.iter().map(|v| {
                let p = m.ap(v.p());
                V { x: p.x, y: p.y, b: if refl { -v.b } else { v.b } }
            }).collect(),
            closed: *closed,
            filled: *filled,
        },
        Geo::Circle { c, r } => Geo::Circle { c: m.ap(*c), r: r * s },
        Geo::Arc { c, r, a0, a1 } => {
            let (n0, n1) = (ang(*a0), ang(*a1));
            let (a0, a1) = if refl { (n1, n0) } else { (n0, n1) };
            Geo::Arc { c: m.ap(*c), r: r * s, a0: a0.rem_euclid(360.0), a1: a1.rem_euclid(360.0) }
        }
        Geo::Ellipse { c, major, ratio, t0, t1 } => {
            let (t0, t1) = if refl { (-t1, -t0) } else { (*t0, *t1) };
            Geo::Ellipse { c: m.ap(*c), major: m.av(*major), ratio: *ratio, t0, t1 }
        }
        Geo::Text(t) => Geo::Text(xt(t, m)),
        Geo::Point { p } => Geo::Point { p: m.ap(*p) },
        Geo::Insert { block, p, sx, sy, rot, cols, rows, cs, rs, attribs } => {
            let nrot = ang(*rot);
            let (nsx, nsy) = if refl { (*sx * s, -*sy * s) } else { (*sx * s, *sy * s) };
            Geo::Insert {
                block: block.clone(),
                p: m.ap(*p),
                sx: nsx,
                sy: nsy,
                rot: nrot.rem_euclid(360.0),
                cols: *cols,
                rows: *rows,
                cs: cs * s,
                rs: if refl { -rs * s } else { rs * s },
                attribs: attribs.iter().map(|a| xt(a, m)).collect(),
            }
        }
        Geo::Hatch { loops, solid, pattern, bg } => Geo::Hatch {
            loops: loops.iter().map(|lp| lp.iter().map(|v| {
                let p = m.ap(v.p());
                V { x: p.x, y: p.y, b: if refl { -v.b } else { v.b } }
            }).collect()).collect(),
            solid: *solid,
            pattern: pattern.iter().map(|pl| crate::tess::xform_pat(pl, m)).collect(),
            bg: *bg,
        },
    }
}
