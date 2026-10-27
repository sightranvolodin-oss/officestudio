/*
 * Pencil over any tab (Ctrl+/). In the classic editors the shortcut turns on their own red pencil,
 * whose marks are saved into the file. Over the full editors (WordCraft, GridCraft, DeckCraft,
 * CADCraft), the classic spreadsheet and the home screen, marks are drawn on a transparent
 * layer over the tab: they stay with the tab while it is open and can be saved as a picture of
 * the screen with the marks.
 */
(function () {
  const { el, icon, toast } = UI;
  const COLORS = [['#e5262b', 'Красный'], ['#1d4ed8', 'Синий'], ['#15803d', 'Зелёный'], ['#111827', 'Чёрный'], ['#facc15', 'Маркер (жёлтый)']];

  class Annotations {
    constructor(host) {
      this.host = host; // #views
      this.canvas = el('canvas', { class: 'annot-canvas' });
      this.layer = el('div', { class: 'annot-layer' }, [this.canvas]);
      this.bar = el('div', { class: 'annot-bar' });
      host.append(this.layer, this.bar);
      this.on = false;
      this.tab = null;
      this.color = COLORS[0][0];
      this.width = 3;
      this.tool = 'pen';
      this.buildBar();
      const ro = new ResizeObserver(() => this.resize());
      ro.observe(host);
      this.canvas.addEventListener('pointerdown', (e) => this.down(e));
      this.canvas.addEventListener('pointermove', (e) => this.move(e));
      this.canvas.addEventListener('pointerup', (e) => this.up(e));
      this.canvas.addEventListener('pointercancel', (e) => this.up(e));
      window.addEventListener('keydown', (e) => {
        if (!this.on) return;
        if (e.key === 'Escape') { e.preventDefault(); this.setOn(false); }
        else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'я')) { e.preventDefault(); this.undo(); }
      }, true);
      this.resize();
    }

    buildBar() {
      const b = this.bar;
      b.innerHTML = '';
      b.append(el('span', { class: 'annot-title', text: 'Пометки' }));
      this.colorBtns = COLORS.map(([c, name]) => {
        const x = el('button', { class: 'annot-color', title: name, style: { background: c } });
        x.addEventListener('click', () => { this.color = c; this.tool = c === '#facc15' ? 'marker' : 'pen'; this.syncBar(); });
        b.append(x);
        return x;
      });
      const wSel = el('select', { title: 'Толщина' }, [['2', 'Тонко'], ['3', 'Средне'], ['6', 'Толсто']].map(([v, t]) => el('option', { value: v, text: t })));
      wSel.value = '3';
      wSel.addEventListener('change', () => { this.width = +wSel.value; });
      b.append(wSel);
      this.eraserBtn = el('button', { class: 'annot-btn', title: 'Ластик: проведите по пометке', html: icon('eraser', 16) });
      this.eraserBtn.addEventListener('click', () => { this.tool = this.tool === 'eraser' ? 'pen' : 'eraser'; this.syncBar(); });
      const undo = el('button', { class: 'annot-btn', title: 'Отменить (Ctrl+Z)', html: icon('undo', 16) });
      undo.addEventListener('click', () => this.undo());
      const clear = el('button', { class: 'annot-btn', title: 'Стереть все пометки на этой вкладке', html: icon('trash', 16) });
      clear.addEventListener('click', () => { if (this.tab) { this.store().push({ clear: this.strokes().splice(0) }); this.draw(); this.changed(); } });
      const snap = el('button', { class: 'annot-btn', title: 'Сохранить снимок с пометками (PNG)', html: icon('image', 16) });
      snap.addEventListener('click', () => this.snapshot());
      const done = el('button', { class: 'annot-done', text: 'Готово (Esc)' });
      done.addEventListener('click', () => this.setOn(false));
      b.append(this.eraserBtn, undo, clear, snap, done);
      this.syncBar();
    }
    syncBar() {
      this.colorBtns.forEach((x, i) => x.classList.toggle('on', this.tool !== 'eraser' && COLORS[i][0] === this.color));
      this.eraserBtn.classList.toggle('on', this.tool === 'eraser');
      this.canvas.style.cursor = this.tool === 'eraser' ? 'cell' : 'crosshair';
    }

    strokes() { if (!this.tab) return []; this.tab.annot = this.tab.annot || []; return this.tab.annot; }
    /** the file the marks belong to (remembered between sessions); none for a new, unsaved file */
    key(tab) { return tab && !tab.home ? tab.path || tab.openedFrom || null : tab && tab.home ? 'home' : null; }
    changed() {
      const tab = this.tab;
      const key = this.key(tab);
      if (!key) return;
      clearTimeout(this.saveT);
      this.saveT = setTimeout(() => window.api.annotSet(key, { strokes: tab.annot || [] }), 400);
    }
    async restore(tab) {
      const key = this.key(tab);
      if (!key || tab.annotLoaded === key) return;
      tab.annotLoaded = key;
      const v = await window.api.annotGet(key);
      if (v && v.strokes && v.strokes.length && !(tab.annot && tab.annot.length)) {
        tab.annot = v.strokes;
        if (this.tab === tab) this.draw();
      }
    }
    store() { if (!this.tab) return []; this.tab.annotUndo = this.tab.annotUndo || []; return this.tab.annotUndo; }

    /** the tab whose marks are shown (null: none) */
    show(tab) {
      this.tab = tab;
      if (tab) this.restore(tab);
      if (!tab && this.on) this.setOn(false);
      this.draw();
    }
    setOn(v) {
      this.on = v && !!this.tab;
      this.layer.classList.toggle('on', this.on);
      this.bar.classList.toggle('on', this.on);
      if (this.onToggle) this.onToggle(this.on);
      if (this.on) toast('Пометки: рисуйте мышью поверх вкладки. Esc или Ctrl+/ — закончить.', null, 4000);
      this.draw();
    }
    toggle() { this.setOn(!this.on); }

    resize() {
      const r = this.host.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.round(r.width * dpr));
      this.canvas.height = Math.max(1, Math.round(r.height * dpr));
      this.canvas.style.width = r.width + 'px';
      this.canvas.style.height = r.height + 'px';
      this.draw();
    }
    pos(e) { const r = this.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    down(e) {
      if (!this.on || e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.pos(e);
      if (this.tool === 'eraser') { this.erasing = true; this.eraseAt(p); return; }
      this.live = { color: this.color, width: this.tool === 'marker' ? 14 : this.width, marker: this.tool === 'marker', pts: [p] };
      this.draw();
    }
    move(e) {
      if (this.erasing) return this.eraseAt(this.pos(e));
      if (!this.live) return;
      this.live.pts.push(this.pos(e));
      this.draw();
    }
    up() {
      if (this.erasing) { this.erasing = false; return; }
      if (!this.live) return;
      const s = this.live;
      this.live = null;
      if (window.Ink && s.pts.length > 2) s.pts = window.Ink.simplify(s.pts, 0.6);
      this.strokes().push(s);
      this.store().push({ add: s });
      this.draw();
      this.changed();
    }
    eraseAt([x, y]) {
      const list = this.strokes();
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].pts.some(([a, b]) => Math.hypot(a - x, b - y) < 8 + list[i].width / 2)) {
          this.store().push({ remove: list[i], at: i });
          list.splice(i, 1);
          this.draw();
          this.changed();
          return;
        }
      }
    }
    undo() {
      const u = this.store().pop();
      if (!u) return;
      const list = this.strokes();
      if (u.add) { const i = list.indexOf(u.add); if (i >= 0) list.splice(i, 1); }
      else if (u.remove) list.splice(Math.min(u.at, list.length), 0, u.remove);
      else if (u.clear) list.push(...u.clear);
      this.draw();
      this.changed();
    }
    draw() {
      const ctx = this.canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const list = this.tab ? this.strokes().concat(this.live ? [this.live] : []) : [];
      this.layer.classList.toggle('has', list.length > 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of list) {
        ctx.globalAlpha = s.marker ? 0.35 : 1;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.beginPath();
        s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (s.pts.length === 1) ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    async snapshot() {
      this.bar.classList.remove('on');
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const r = this.host.getBoundingClientRect();
      const res = await window.api.saveScreenshot({ rect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }, suggestedName: (this.tab && this.tab.name ? this.tab.name.replace(/\.[^.]+$/, '') : 'Снимок') + ' — пометки' });
      if (this.on) this.bar.classList.add('on');
      if (res && res.ok) toast('Снимок сохранён: ' + res.path);
      else if (res && res.error) toast('Не удалось сохранить снимок: ' + res.error, 'error', 6000);
    }
  }

  window.Annotations = Annotations;
})();
