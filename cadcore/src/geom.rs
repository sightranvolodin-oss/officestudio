//! Geometry helpers: affine matrices, arc/ellipse/spline sampling, distances, bounding boxes.

use crate::model::{TextData, P, V};
use std::f64::consts::PI;

pub const D2R: f64 = PI / 180.0;

/// 2D affine matrix: x' = a x + c y + e ; y' = b x + d y + f
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct M(pub [f64; 6]);
impl M {
    pub const ID: M = M([1.0, 0.0, 0.0, 1.0, 0.0, 0.0]);
    pub fn mul(&self, n: &M) -> M {
        let (m, n) = (&self.0, &n.0);
        M([
            m[0] * n[0] + m[2] * n[1],
            m[1] * n[0] + m[3] * n[1],
            m[0] * n[2] + m[2] * n[3],
            m[1] * n[2] + m[3] * n[3],
            m[0] * n[4] + m[2] * n[5] + m[4],
            m[1] * n[4] + m[3] * n[5] + m[5],
        ])
    }
    #[inline]
    pub fn ap(&self, p: P) -> P {
        let m = &self.0;
        P::new(m[0] * p.x + m[2] * p.y + m[4], m[1] * p.x + m[3] * p.y + m[5])
    }
    /// linear part only (vectors)
    #[inline]
    pub fn av(&self, v: P) -> P {
        let m = &self.0;
        P::new(m[0] * v.x + m[2] * v.y, m[1] * v.x + m[3] * v.y)
    }
    pub fn det(&self) -> f64 {
        self.0[0] * self.0[3] - self.0[1] * self.0[2]
    }
    pub fn inv(&self) -> M {
        let m = &self.0;
        let d = self.det();
        if d.abs() < 1e-300 {
            return M::ID;
        }
        M([m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d])
    }
    /// uniform scale estimate
    pub fn scale(&self) -> f64 {
        self.det().abs().sqrt()
    }
    pub fn translate(x: f64, y: f64) -> M {
        M([1.0, 0.0, 0.0, 1.0, x, y])
    }
    pub fn rotate(deg: f64) -> M {
        let (s, c) = (deg * D2R).sin_cos();
        M([c, s, -s, c, 0.0, 0.0])
    }
    pub fn scaling(sx: f64, sy: f64) -> M {
        M([sx, 0.0, 0.0, sy, 0.0, 0.0])
    }
    /// INSERT transform: translate(p) * rotate(rot) * scale(sx,sy) * translate(-base)
    pub fn insert(p: P, rot: f64, sx: f64, sy: f64, base: P) -> M {
        M::translate(p.x, p.y).mul(&M::rotate(rot)).mul(&M::scaling(sx, sy)).mul(&M::translate(-base.x, -base.y))
    }
}

#[inline]
pub fn dist(a: P, b: P) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
#[inline]
pub fn lerp(a: P, b: P, t: f64) -> P {
    P::new(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)
}

pub fn seg_dist(p: P, a: P, b: P) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l = dx * dx + dy * dy;
    let t = if l > 0.0 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l).clamp(0.0, 1.0) } else { 0.0 };
    (p.x - (a.x + t * dx)).hypot(p.y - (a.y + t * dy))
}
pub fn polyline_dist(p: P, pts: &[P]) -> f64 {
    if pts.len() == 1 {
        return dist(p, pts[0]);
    }
    pts.windows(2).map(|w| seg_dist(p, w[0], w[1])).fold(f64::INFINITY, f64::min)
}
pub fn point_in_poly(p: P, pts: &[P]) -> bool {
    let mut inside = false;
    let n = pts.len();
    if n < 3 {
        return false;
    }
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (pts[i], pts[j]);
        if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
            inside = !inside;
        }
        j = i;
    }
    inside
}
pub fn poly_area(pts: &[P]) -> f64 {
    let n = pts.len();
    let mut s = 0.0;
    for i in 0..n {
        let (a, b) = (pts[i], pts[(i + 1) % n]);
        s += a.x * b.y - b.x * a.y;
    }
    s / 2.0
}

/// Arc segment defined by a bulge between two vertices
pub struct BArc {
    pub c: P,
    pub r: f64,
    pub a0: f64,
    pub sweep: f64,
}
pub fn bulge_arc(p1: P, p2: P, b: f64) -> BArc {
    let d = dist(p1, p2).max(1e-300);
    let theta = 4.0 * b.atan();
    let r = (d / (2.0 * (theta / 2.0).sin())).abs();
    let mid = lerp(p1, p2, 0.5);
    let (nx, ny) = (-(p2.y - p1.y) / d, (p2.x - p1.x) / d);
    let s = (d / 2.0) * ((1.0 - b * b) / (2.0 * b));
    let c = P::new(mid.x + nx * s, mid.y + ny * s);
    let a0 = (p1.y - c.y).atan2(p1.x - c.x);
    let a1 = (p2.y - c.y).atan2(p2.x - c.x);
    let mut sweep = a1 - a0;
    if b > 0.0 && sweep < 0.0 {
        sweep += 2.0 * PI;
    }
    if b < 0.0 && sweep > 0.0 {
        sweep -= 2.0 * PI;
    }
    BArc { c, r, a0, sweep }
}

/// number of segments for an arc of radius r and sweep (radians), given a chord tolerance
pub fn arc_segments(r: f64, sweep: f64, tol: f64) -> usize {
    let sweep = sweep.abs();
    if r <= 0.0 || tol <= 0.0 {
        return 8;
    }
    let step = if tol >= r { PI / 2.0 } else { 2.0 * (1.0 - tol / r).acos() };
    let n = (sweep / step.max(1e-4)).ceil() as usize;
    let full = (sweep / (2.0 * PI)).max(0.02);
    // minimum density by size relative to the tolerance: big curves stay smooth, tiny ones stay cheap
    let per_circle = if r > 40.0 * tol { 64.0 } else if r > 8.0 * tol { 24.0 } else { 12.0 };
    n.clamp(((per_circle * full).ceil() as usize).max(2), 512)
}

/// Polyline vertices expanded with arc samples (closing back to the first vertex if closed)
pub fn poly_points(pts: &[V], closed: bool, tol: f64) -> Vec<P> {
    let n = pts.len();
    let mut out = Vec::with_capacity(n + 1);
    if n == 0 {
        return out;
    }
    let last = if closed { n } else { n - 1 };
    for i in 0..last {
        let a = pts[i];
        let b = pts[(i + 1) % n];
        out.push(a.p());
        if a.b != 0.0 && (a.x != b.x || a.y != b.y) {
            let arc = bulge_arc(a.p(), b.p(), a.b);
            let k = arc_segments(arc.r, arc.sweep, tol);
            for j in 1..k {
                let t = arc.a0 + arc.sweep * j as f64 / k as f64;
                out.push(P::new(arc.c.x + arc.r * t.cos(), arc.c.y + arc.r * t.sin()));
            }
        }
    }
    if closed {
        out.push(pts[0].p());
    } else {
        out.push(pts[n - 1].p());
    }
    out
}

pub fn arc_points(c: P, r: f64, a0deg: f64, a1deg: f64, tol: f64) -> Vec<P> {
    let a0 = a0deg * D2R;
    let mut a1 = a1deg * D2R;
    while a1 <= a0 {
        a1 += 2.0 * PI;
    }
    let k = arc_segments(r, a1 - a0, tol);
    (0..=k).map(|i| {
        let t = a0 + (a1 - a0) * i as f64 / k as f64;
        P::new(c.x + r * t.cos(), c.y + r * t.sin())
    }).collect()
}
pub fn circle_points(c: P, r: f64, tol: f64) -> Vec<P> {
    let k = arc_segments(r, 2.0 * PI, tol).max(12);
    (0..=k).map(|i| {
        let t = 2.0 * PI * i as f64 / k as f64;
        P::new(c.x + r * t.cos(), c.y + r * t.sin())
    }).collect()
}
pub fn ellipse_points(c: P, major: P, ratio: f64, t0: f64, t1: f64, tol: f64) -> Vec<P> {
    let mut t1 = t1;
    while t1 <= t0 {
        t1 += 2.0 * PI;
    }
    let rm = major.x.hypot(major.y);
    let k = arc_segments(rm, t1 - t0, tol).max(8);
    (0..=k).map(|i| {
        let t = t0 + (t1 - t0) * i as f64 / k as f64;
        let (s, co) = t.sin_cos();
        P::new(c.x + major.x * co - major.y * ratio * s, c.y + major.y * co + major.x * ratio * s)
    }).collect()
}

/// NURBS evaluation by de Boor in homogeneous coordinates
pub fn nurbs(ctrl: &[P], weights: &[f64], degree: usize, knots: &[f64], segments: usize) -> Vec<P> {
    let n = ctrl.len();
    if n < 2 || degree == 0 || knots.len() != n + degree + 1 {
        return ctrl.to_vec();
    }
    let w = |i: usize| if weights.len() == n { weights[i] } else { 1.0 };
    let (lo, hi) = (knots[degree], knots[n]);
    if !(hi > lo) {
        return ctrl.to_vec();
    }
    let mut out = Vec::with_capacity(segments + 1);
    for s in 0..=segments {
        let t = lo + (hi - lo) * s as f64 / segments as f64;
        let mut k = degree;
        while k < n - 1 && t >= knots[k + 1] {
            k += 1;
        }
        let mut d: Vec<[f64; 3]> = (0..=degree).map(|j| {
            let i = k - degree + j;
            let wi = w(i);
            [ctrl[i].x * wi, ctrl[i].y * wi, wi]
        }).collect();
        for r in 1..=degree {
            for j in (r..=degree).rev() {
                let i = k - degree + j;
                let den = knots[i + degree - r + 1] - knots[i];
                let a = if den == 0.0 { 0.0 } else { (t - knots[i]) / den };
                for q in 0..3 {
                    d[j][q] = (1.0 - a) * d[j - 1][q] + a * d[j][q];
                }
            }
        }
        let h = d[degree];
        if h[2] != 0.0 {
            out.push(P::new(h[0] / h[2], h[1] / h[2]));
        }
    }
    out
}

/// Smooth curve through fit points (centripetal Catmull-Rom)
pub fn catmull_rom(pts: &[P], seg: usize, closed: bool) -> Vec<P> {
    let n = pts.len();
    if n < 3 {
        return pts.to_vec();
    }
    let get = |i: isize| -> P {
        if closed {
            pts[i.rem_euclid(n as isize) as usize]
        } else {
            pts[i.clamp(0, n as isize - 1) as usize]
        }
    };
    let mut out = Vec::new();
    let cnt = if closed { n } else { n - 1 };
    for i in 0..cnt as isize {
        let (p0, p1, p2, p3) = (get(i - 1), get(i), get(i + 1), get(i + 2));
        let d = |a: P, b: P| dist(a, b).sqrt().max(1e-9);
        let t0 = 0.0;
        let t1 = t0 + d(p0, p1);
        let t2 = t1 + d(p1, p2);
        let t3 = t2 + d(p2, p3);
        for k in 0..seg {
            let t = t1 + (t2 - t1) * k as f64 / seg as f64;
            let l = |a: P, b: P, ta: f64, tb: f64| P::new(((tb - t) * a.x + (t - ta) * b.x) / (tb - ta), ((tb - t) * a.y + (t - ta) * b.y) / (tb - ta));
            let a1 = l(p0, p1, t0, t1);
            let a2 = l(p1, p2, t1, t2);
            let a3 = l(p2, p3, t2, t3);
            let b1 = l(a1, a2, t0, t2);
            let b2 = l(a2, a3, t1, t3);
            out.push(l(b1, b2, t1, t2));
        }
    }
    out.push(if closed { pts[0] } else { pts[n - 1] });
    out
}

/// Corner points of a text's bounding box in world coordinates
pub fn text_box(t: &TextData) -> [P; 4] {
    let lines: Vec<&str> = t.text.split('\n').collect();
    let maxc = lines.iter().map(|l| l.chars().count()).max().unwrap_or(1).max(1) as f64;
    let w = maxc * t.h * 0.62 * t.wf;
    let lh = t.h * 1.6;
    let hh = t.h + (lines.len() as f64 - 1.0) * lh;
    let ha = t.halign as i32;
    let va = t.valign as i32;
    let ox = if ha == 1 || ha == 4 { -w / 2.0 } else if ha == 2 { -w } else { 0.0 };
    let mut oy = if t.mtext {
        if va == 3 { -hh } else if va == 2 { -hh / 2.0 } else { 0.0 }
    } else if va == 3 {
        -t.h
    } else if va == 2 {
        -t.h / 2.0
    } else {
        0.0
    };
    if !t.mtext && lines.len() > 1 {
        oy -= (lines.len() as f64 - 1.0) * lh;
    }
    let (s, c) = (t.rot * D2R).sin_cos();
    let f = |x: f64, y: f64| P::new(t.p.x + x * c - y * s, t.p.y + x * s + y * c);
    [f(ox, oy), f(ox + w, oy), f(ox + w, oy + hh), f(ox, oy + hh)]
}

#[derive(Clone, Copy, Debug)]
pub struct BB {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}
impl Default for BB {
    fn default() -> Self {
        BB::EMPTY
    }
}
impl BB {
    pub const EMPTY: BB = BB { x1: f64::INFINITY, y1: f64::INFINITY, x2: f64::NEG_INFINITY, y2: f64::NEG_INFINITY };
    #[inline]
    pub fn add(&mut self, p: P) {
        if p.x.is_finite() && p.y.is_finite() {
            self.x1 = self.x1.min(p.x);
            self.y1 = self.y1.min(p.y);
            self.x2 = self.x2.max(p.x);
            self.y2 = self.y2.max(p.y);
        }
    }
    pub fn union(&mut self, o: &BB) {
        if o.valid() {
            self.add(P::new(o.x1, o.y1));
            self.add(P::new(o.x2, o.y2));
        }
    }
    pub fn valid(&self) -> bool {
        self.x1 <= self.x2 && self.y1 <= self.y2
    }
    pub fn corners(&self) -> [P; 4] {
        [P::new(self.x1, self.y1), P::new(self.x2, self.y1), P::new(self.x2, self.y2), P::new(self.x1, self.y2)]
    }
    pub fn diag(&self) -> f64 {
        if self.valid() { (self.x2 - self.x1).hypot(self.y2 - self.y1) } else { 0.0 }
    }
}
