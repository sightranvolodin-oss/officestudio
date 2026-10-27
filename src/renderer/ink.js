/* Shared freehand "red pencil" helpers used by all three editors */
(function () {
  const INK_COLOR = '#e5262b';

  // Ramer–Douglas–Peucker simplification; points are [x, y]
  function simplify(pts, tol) {
    if (pts.length < 3) return pts.slice();
    const sq = tol * tol;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = pts[a], [bx, by] = pts[b];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let best = -1, bd = sq;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = pts[i];
        let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
        t = Math.max(0, Math.min(1, t));
        const ex = ax + t * dx - px, ey = ay + t * dy - py;
        const d = ex * ex + ey * ey;
        if (d > bd) { bd = d; best = i; }
      }
      if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // smooth SVG path through points (quadratic curves through midpoints)
  function pathD(pts) {
    const r = (v) => Math.round(v * 1000) / 1000;
    if (!pts.length) return '';
    if (pts.length === 1) return `M${r(pts[0][0])},${r(pts[0][1])}l0.001,0`;
    if (pts.length === 2) return `M${r(pts[0][0])},${r(pts[0][1])}L${r(pts[1][0])},${r(pts[1][1])}`;
    let d = `M${r(pts[0][0])},${r(pts[0][1])}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += `Q${r(pts[i][0])},${r(pts[i][1])} ${r(mx)},${r(my)}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${r(l[0])},${r(l[1])}`;
  }

  function distToPolyline(p, pts) {
    if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? ((p[0] - ax) * dx + (p[1] - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(ax + t * dx - p[0], ay + t * dy - p[1]));
    }
    return best;
  }

  function bbox(pts) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const [x, y] of pts) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
    return { x1, y1, x2, y2 };
  }

  // Track a mouse drag. toLocal(ev) -> [x, y]. Calls onPoint(pts) while drawing and onEnd(pts) on release.
  function capture(ev, toLocal, onPoint, onEnd) {
    const pts = [toLocal(ev)];
    onPoint && onPoint(pts);
    // pointermove + getCoalescedEvents gives every sample, not just one per frame (smoother fast strokes)
    const move = (e) => {
      const list = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
      let added = false;
      for (const ce of list.length ? list : [e]) {
        const p = toLocal(ce);
        const l = pts[pts.length - 1];
        if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0) { pts.push(p); added = true; }
      }
      if (added && onPoint) onPoint(pts);
    };
    const up = (e) => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (e && e.clientX !== undefined) { const p = toLocal(e); const l = pts[pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0) pts.push(p); }
      onEnd(pts);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  }

  // Render a stroke to a transparent PNG (used for DOCX export). pts are in px.
  function strokePng(pts, color, width, scale = 2) {
    const b = bbox(pts);
    const pad = width;
    const w = Math.max(1, b.x2 - b.x1 + pad * 2), h = Math.max(1, b.y2 - b.y1 + pad * 2);
    const c = document.createElement('canvas');
    c.width = Math.ceil(w * scale); c.height = Math.ceil(h * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(pathD(pts.map(([x, y]) => [x - b.x1 + pad, y - b.y1 + pad]))));
    return { dataUrl: c.toDataURL('image/png'), x: b.x1 - pad, y: b.y1 - pad, w, h };
  }

  window.Ink = { COLOR: INK_COLOR, simplify, pathD, distToPolyline, bbox, capture, strokePng };
})();
