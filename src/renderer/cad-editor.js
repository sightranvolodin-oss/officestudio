/* AutoCAD-like drawing editor. Geometry, indexing, editing and DXF I/O run in the Rust engine
   (WebAssembly); drawing goes through WebGL2. This file is the UI: tools, commands, panels. */
(function () {
  const { el, btn, group, colorButton, toast, modal, icon } = UI;
  const BG = '#1b1e24';
  const FG = '#e8eaed';
  const BG_KEY = 'officestudio.cad.bg';
  const TS = 13; // numbers per text in eng.texts(): x y h rot ha va mtext wf layer rgb alpha mask maskK
  const BG_MASK = 0x1000000;
  const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const isNeutral = (h) => { const [r, g, b] = hexRGB(h); return (r > 250 && g > 250 && b > 250) || (r < 5 && g < 5 && b < 5); };
  const luminance = (h) => { const [r, g, b] = hexRGB(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
  const BG_PRESETS = [
    ['#1b1e24', 'Тёмный (по умолчанию)'],
    ['#212830', 'Тёмно-серый, как в AutoCAD'],
    ['#000000', 'Чёрный'],
    ['#0e2a47', 'Синий «калька»'],
    ['#4b5058', 'Серый'],
    ['#d9dce1', 'Светло-серый'],
    ['#fdfcf7', 'Бумага'],
    ['#ffffff', 'Белый'],
  ];
  const parseHex = (h) => { const n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const x = parseHex(a), y = parseHex(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  /** all drawing colours derived from the background: ACI 7 lines turn black on light backgrounds, like AutoCAD */
  function makeTheme(bg) {
    const [r, g, b] = parseHex(bg).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35;
    const fg = light ? '#000000' : FG;
    return {
      bg, fg, light,
      grid1: mix(bg, fg, light ? 0.06 : 0.05), grid2: mix(bg, fg, light ? 0.12 : 0.1), axis: mix(bg, fg, 0.2),
      cross: light ? 'rgba(0, 0, 0, .7)' : 'rgba(232, 234, 237, .75)',
      accent: light ? '#c26a00' : '#ffd166', ghost: light ? '#7a828f' : '#8a94a6', hint: mix(bg, fg, 0.45),
      sel: light ? [0.05, 0.4, 0.9] : [0.3, 0.64, 1], preview: light ? [0.85, 0.45, 0] : [1, 0.82, 0.4],
    };
  }
  const OPT_KEY = 'officestudio.cad.colors';
  function savedOpts() { try { return { darken: true, mono: false, ...JSON.parse(localStorage.getItem(OPT_KEY) || '{}') }; } catch { return { darken: true, mono: false }; } }
  function savedBg() { try { return localStorage.getItem(BG_KEY) || BG; } catch { return BG; } }
  const SEL = '#4da3ff';
  const D2R = Math.PI / 180;
  const INK_LAYER = 'Пометки';
  const INK_RED = '#ff0000';

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const fmt = (v) => (Math.abs(v) >= 1e5 ? v.toExponential(3) : (+v.toFixed(4)).toString());
  const hexRgb = (h) => { const n = parseInt((h || '#ffffff').slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  const SNAP_KIND = ['end', 'mid', 'cen', 'ins'];

  // ------------------------------------------------------------ small geometry helpers (previews only)
  function bulgeArc(p1, p2, b) {
    const d = dist(p1, p2);
    const theta = 4 * Math.atan(b);
    const r = d / (2 * Math.sin(theta / 2));
    const mid = lerp(p1, p2, 0.5);
    const nx = -(p2.y - p1.y) / d, ny = (p2.x - p1.x) / d;
    const s = (d / 2) * ((1 - b * b) / (2 * b));
    const c = { x: mid.x + nx * s, y: mid.y + ny * s };
    return { c, r: Math.abs(r), a0: Math.atan2(p1.y - c.y, p1.x - c.x), a1: Math.atan2(p2.y - c.y, p2.x - c.x), ccw: b > 0 };
  }
  function threePointArc(p1, p2, p3) {
    const ax = p1.x, ay = p1.y, bx = p2.x, by = p2.y, cx = p3.x, cy = p3.y;
    const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-12) return null;
    const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
    const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
    const c = { x: ux, y: uy }, r = dist(c, p1);
    const ang = (p) => ((Math.atan2(p.y - uy, p.x - ux) / D2R) + 360) % 360;
    let a0 = ang(p1), a1 = ang(p3);
    const am = ang(p2);
    const inCCW = (s, e, m) => (m - s + 360) % 360 < (e - s + 360) % 360;
    if (!inCCW(a0, a1, am)) [a0, a1] = [a1, a0];
    return { c, r, a0, a1 };
  }
  // similarity matrices [a,b,c,d,e,f]: x' = a x + c y + e ; y' = b x + d y + f
  const Mx = {
    translate: (dx, dy) => [1, 0, 0, 1, dx, dy],
    rotateAbout: (c, deg) => { const r = deg * D2R, cs = Math.cos(r), sn = Math.sin(r); return [cs, sn, -sn, cs, c.x - cs * c.x + sn * c.y, c.y - sn * c.x - cs * c.y]; },
    mirror: (a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
      const m00 = (dx * dx - dy * dy) / L, m01 = (2 * dx * dy) / L, m11 = (dy * dy - dx * dx) / L;
      return [m00, m01, m01, m11, a.x - m00 * a.x - m01 * a.y, a.y - m01 * a.x - m11 * a.y];
    },
    apply: (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }),
  };

  // ======================================================================
  class CadEditor {
    constructor(root, data, { onDirty }) {
      this.root = root;
      this.onDirty = onDirty;
      this.color = null; // ByLayer for new objects
      this.sel = new Set();
      this.view = { cx: 148, cy: 105, s: 2 };
      this.flags = { grid: true, snap: false, ortho: false, osnap: true };
      this.cmd = null;
      this.lastCmd = null;
      this.mouse = { x: 0, y: 0, inside: false };
      this.textH = null;
      this.curLayer = '0';
      this.layers = [];
      this.texts = { f: new Float64Array(0), s: [] };
      this.ink = new Float64Array(0);
      this.jsonCache = new Map();
      this.dimN = 0;
      this.theme = makeTheme(savedBg());
      this.colorOpts = savedOpts();
      this.onBgChange = (e) => this.setBackground(e.detail, false);
      window.addEventListener('cad-bg-change', this.onBgChange);

      this.bgCanvas = el('canvas');
      this.glCanvas = el('canvas');
      this.textCanvas = el('canvas');
      this.over = el('canvas', { class: 'overlay' });
      this.wrap = el('div', { class: 'cad-canvas-wrap', tabindex: '0' }, [this.bgCanvas, this.glCanvas, this.textCanvas, this.over]);
      this.wrap.style.background = this.theme.bg;
      this.side = el('div', { class: 'cad-side' });
      this.prompt = el('span', { class: 'prompt', text: 'Команда:' });
      this.input = el('input', { type: 'text', spellcheck: 'false', placeholder: 'введите команду (L, PL, C, REC, A, T, M, CO, RO, DIM, E…) или координаты' });
      this.coords = el('span', { class: 'coords' });
      const cmdbar = el('div', { class: 'cad-cmd' }, [this.prompt, this.input, this.coords]);
      root.append(this.buildToolbar(), el('div', { class: 'cad-main' }, [el('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, position: 'relative' } }, [this.wrap, cmdbar]), this.side]), this.buildStatus());
      this.info.textContent = 'Загрузка движка…';

      this.ready = CadCore.load().then(() => this.init(data)).catch((e) => {
        console.error(e);
        toast('Не удалось открыть чертёж: ' + (e.message || e), 'error', 8000);
        this.info.textContent = 'Ошибка: ' + (e.message || e);
      });
    }

    init(data) {
      this.eng = new CadCore.Engine();
      const t0 = performance.now();
      if (data && data.dxf) {
        const st = JSON.parse(this.eng.load_dxf(data.dxf));
        this.loadStats = st;
      }
      try {
        if (window.OS_FORCE_2D) throw new Error('forced');
        const g = new GLView(this.glCanvas);
        if (g.software && !window.OS_FORCE_GL) throw new Error('software GL: ' + g.rendererName);
        this.gl = g;
      } catch (e) {
        // no hardware WebGL2 (old driver, remote desktop, VM…): the culled 2D renderer is faster there
        const fresh = el('canvas');
        this.glCanvas.replaceWith(fresh);
        this.glCanvas = fresh;
        this.gl = new Canvas2DView(fresh);
        console.info('Drawing renderer: Canvas 2D (' + e.message + ')');
      }
      this.origin = this.eng.origin();
      this.rebuild(true);
      this.refreshLayers();
      if (!this.layers.some((l) => l.name === this.curLayer)) this.curLayer = this.layers[0] ? this.layers[0].name : '0';
      this.bind();
      this.ro = new ResizeObserver(() => this.resize());
      this.ro.observe(this.wrap);
      this.resize();
      if (this.eng.count()) this.zoomExtents();
      else this.view = { cx: 148, cy: 105, s: Math.min(this.W / 340, this.H / 250) || 2 };
      this.buildSide();
      this.syncUnitBtn();
      const ms = Math.round(performance.now() - t0);
      this.info.textContent = (this.loadStats ? `Объектов: ${this.eng.count().toLocaleString('ru')} · открыт за ${ms} мс · ` : '') + (this.gl.software ? 'программная отрисовка' : 'видеоускорение');
      this.redraw();
    }

    // ------------------------------------------------------------ engine sync
    /** full rebuild of GPU buffers (load, or after many edits) */
    rebuild(initial, extraView) {
      this.eng.build_base();
      this.gl.upload('base', this.eng);
      if (extraView) extraView.upload('base', this.eng);
      this.eng.release_base();
      this.eng.take_hidden();
      this.eng.build_overlay();
      this.gl.upload('overlay', this.eng);
      if (extraView) extraView.upload('overlay', this.eng);
      this.reloadTexts();
      this.reloadInk();
      if (!initial) this.syncSel();
    }
    /** after any edit: hide changed objects in the base buffer and redraw the small overlay */
    afterEdit() {
      this.jsonCache.clear();
      if (this.eng.dirty_count() > 40000) {
        this.rebuild();
      } else {
        this.gl.hide(this.eng.take_hidden());
        this.eng.build_overlay();
        this.gl.upload('overlay', this.eng);
        this.reloadTexts();
        this.reloadInk();
      }
      this.refreshLayers();
      if (this.sel.size) this.sel = new Set(this.eng.alive(Uint32Array.from(this.sel)));
      this.syncSel();
      this.onDirty();
      this.buildSide();
      this.redraw();
    }
    reloadTexts() {
      const f = this.eng.texts();
      const s = this.eng.texts_str();
      this.texts = { f, s: s ? s.split('\u0001') : [] };
    }
    reloadInk() {
      this.ink = this.layers.some((l) => l.name === INK_LAYER) || this.eng.layer_count_of(INK_LAYER) ? this.eng.layer_segments(INK_LAYER) : new Float64Array(0);
    }
    refreshLayers() {
      this.layers = JSON.parse(this.eng.layers_json());
      this.layerByIndex = [];
      for (const l of this.layers) this.layerByIndex[l.index] = { name: l.name, color: hexRgb(l.color), hex: l.color, visible: l.visible, alpha: l.alpha == null ? 255 : l.alpha };
      if (!this.layers.some((l) => l.name === this.curLayer)) this.curLayer = '0';
    }
    syncSel() {
      const ids = Uint32Array.from(this.sel);
      this.eng.build_sel(ids, 400000);
      this.gl.uploadSel(this.eng);
    }
    ent(i) {
      if (!this.jsonCache.has(i)) this.jsonCache.set(i, JSON.parse(this.eng.entity_json(i)));
      return this.jsonCache.get(i);
    }
    newEnt(extra) { return { layer: this.curLayer, ...(this.color ? { color: this.color } : {}), ...extra }; }
    add(ents) {
      const ids = this.eng.add_json(JSON.stringify(ents));
      this.afterEdit();
      return Array.from(ids);
    }

    // ------------------------------------------------------------ UI
    buildToolbar() {
      const T = (name, ic, label, title) => { const b = btn({ icon: ic, title: `${title || label}`, label, keepFocus: false, onClick: () => this.startCmd(name) }); b.dataset.cmd = name; return b; };
      this.cmdBtns = [
        T('select', 'cursor', null, 'Выбор (Esc)'), T('line', 'line', null, 'Отрезок (L)'), T('pline', 'polyline', null, 'Полилиния (PL)'), T('rect', 'rectTool', null, 'Прямоугольник (REC)'),
        T('circle', 'circle', null, 'Окружность (C)'), T('arc', 'arc', null, 'Дуга по 3 точкам (A)'), T('text', 'text', null, 'Текст (T)'), T('dim', 'measure', null, 'Размер (DIM)'),
      ];
      const editBtns = [T('move', 'move', null, 'Переместить (M)'), T('copy', 'copy', null, 'Копировать (CO)'), T('rotate', 'rotate', null, 'Повернуть (RO)'), T('mirror', 'mirror', null, 'Зеркало (MI)'), btn({ icon: 'trash', title: 'Удалить (Del)', keepFocus: false, onClick: () => this.erase() })];
      this.cmdBtns.push(...editBtns.filter((b) => b.dataset.cmd));
      const pen = btn({ icon: 'pencil', label: 'Карандаш', cls: 'pencil', title: 'Красный карандаш: рисуйте пометки поверх чертежа (Esc — выход)', keepFocus: false, onClick: () => this.startCmd(this.cmd && this.cmd.name === 'pencil' ? null : 'pencil') });
      pen.dataset.cmd = 'pencil';
      const er = btn({ icon: 'eraser', title: 'Ластик: проведите по пометкам, чтобы стереть (чертёж не затрагивается)', keepFocus: false, onClick: () => this.startCmd(this.cmd && this.cmd.name === 'inkerase' ? null : 'inkerase') });
      er.dataset.cmd = 'inkerase';
      const clr = btn({ icon: 'inkClear', title: 'Удалить все пометки', keepFocus: false, onClick: () => this.clearInk() });
      this.cmdBtns.push(pen, er);
      const colorBtn = colorButton({ icon: 'paint', title: 'Цвет новых объектов / выделенных (пусто = по слою)', fill: true, allowNone: true, noneLabel: 'По слою', get: () => this.color, onPick: (c) => { this.color = c; if (this.sel.size) this.setProp('color', c); } });
      this.pngBtn = btn({ icon: 'download', label: 'PNG', title: 'Экспорт в PNG', keepFocus: false, onClick: () => this.exportMenu() });
      this.printBtn = btn({ icon: 'pdf', label: 'Печать / PDF', title: 'Печать и PDF в масштабе (Ctrl+P)', keepFocus: false, onClick: () => this.printDialog() });
      return el('div', { class: 'toolbar', style: { '--accent': 'var(--cad)' } }, [
        group(btn({ icon: 'undo', title: 'Отменить (Ctrl+Z)', keepFocus: false, onClick: () => this.undo() }), btn({ icon: 'redo', title: 'Повторить (Ctrl+Y)', keepFocus: false, onClick: () => this.redo() })),
        group(...this.cmdBtns.slice(0, 8)),
        group(...editBtns),
        group(pen, er, clr),
        group(colorBtn),
        group(btn({ icon: 'fit', label: 'Показать всё', title: 'Показать всё (Z)', keepFocus: false, onClick: () => this.zoomExtents() }), btn({ icon: 'ruler', title: 'Измерить расстояние (DI)', keepFocus: false, onClick: () => this.startCmd('measure') }), btn({ icon: 'rectTool', title: 'Площадь и периметр контура (AREA). Если сразу нажать Enter — площадь выделенных объектов', keepFocus: false, onClick: () => this.startCmd('area') }), btn({ icon: 'search', title: 'Найти текст (Ctrl+F)', keepFocus: false, onClick: () => this.find() })),
        group(this.bgBtn = this.makeBgButton(), this.printBtn, this.pngBtn),
      ]);
    }
    makeBgButton() {
      const b = btn({ icon: 'paint', label: 'Фон', title: 'Цвет фона чертежа', keepFocus: false, onClick: () => this.bgMenu(b) });
      b.classList.add('color-btn', 'fill');
      this.bgSwatch = el('span', { class: 'swatch', style: { background: this.theme.bg, border: '1px solid rgba(0,0,0,.25)' } });
      b.append(this.bgSwatch);
      return b;
    }
    bgMenu(anchor) {
      const box = el('div', { class: 'bg-menu' });
      for (const [hex, name] of BG_PRESETS) {
        const row = el('div', { class: 'menu-item' + (hex === this.theme.bg ? ' cur' : '') }, [
          el('span', { class: 'bg-chip', style: { background: hex } }, el('span', { style: { background: makeTheme(hex).fg } })),
          el('span', { text: name }),
        ]);
        row.addEventListener('click', () => { UI.closePopup(); this.setBackground(hex, true); });
        box.append(row);
      }
      box.append(el('div', { class: 'menu-sep' }));
      const custom = el('div', { class: 'menu-item', html: `${icon('paint')}<span>Другой цвет…</span>` });
      custom.addEventListener('click', () => { UI.closePopup(); UI.colorPicker(anchor, { current: this.theme.bg, onPick: (c) => c && this.setBackground(c, true) }); });
      box.append(custom, el('div', { class: 'menu-sep' }));
      const toggle = (key, label, title) => {
        const row = el('label', { class: 'menu-item bg-opt', title }, [el('input', { type: 'checkbox' }), el('span', { text: label })]);
        const cb = row.querySelector('input');
        cb.checked = !!this.colorOpts[key];
        cb.addEventListener('change', () => {
          this.colorOpts = { ...this.colorOpts, [key]: cb.checked };
          try { localStorage.setItem(OPT_KEY, JSON.stringify(this.colorOpts)); } catch {}
          window.dispatchEvent(new CustomEvent('cad-bg-change', { detail: this.theme.bg }));
        });
        box.append(row);
      };
      toggle('darken', 'Затемнять светлые цвета на светлом фоне', 'Голубые, жёлтые и другие светлые линии становятся темнее, чтобы их было видно на белом');
      toggle('mono', 'Все линии одним цветом', 'Монохромный режим — удобно для чтения и печати');
      UI.popupBelow(anchor, box);
    }
    /** change the drawing background (remembered and applied to every open drawing) */
    setBackground(hex, broadcast) {
      this.theme = makeTheme(hex);
      this.colorOpts = savedOpts();
      this.wrap.style.background = hex;
      if (this.bgSwatch) this.bgSwatch.style.background = hex;
      if (broadcast) {
        try { localStorage.setItem(BG_KEY, hex); } catch {}
        window.dispatchEvent(new CustomEvent('cad-bg-change', { detail: hex }));
      }
      this.redraw();
    }
    buildStatus() {
      this.flagBtns = {};
      const mk = (key, label, title) => {
        const b = el('button', { class: 'st-btn' + (this.flags[key] ? ' on' : ''), text: label, title });
        b.addEventListener('click', () => this.toggle(key));
        this.flagBtns[key] = b;
        return b;
      };
      this.info = el('span');
      this.unitBtn = el('button', { class: 'st-btn', title: 'Единицы чертежа — для длин, площадей и масштаба печати. Щёлкните, чтобы изменить.' });
      this.unitBtn.addEventListener('click', () => {
        const r = this.unitBtn.getBoundingClientRect();
        const set = (u) => { this.unitOverride = u; this._unit = null; this.syncUnitBtn(); this.buildProps(); };
        UI.menu(r.left, r.top - 170, [['м', 'метры'], ['мм', 'миллиметры'], ['см', 'сантиметры'], ['км', 'километры']].map(([u, t]) => ({ label: `${t}${this.unitName() === u ? '  ✓' : ''}`, onClick: () => set(u) })));
      });
      return el('div', { class: 'statusbar' }, [el('span', { text: 'Чертёж' }), this.info, el('span', { class: 'spacer' }), this.unitBtn,
        mk('grid', 'СЕТКА', 'Показ сетки (F7)'), mk('snap', 'ШАГ', 'Привязка к сетке (F9)'), mk('ortho', 'ОРТО', 'Ортогональный режим (F8)'), mk('osnap', 'ПРИВЯЗКА', 'Объектная привязка: конечные точки, середины, центры (F3)')]);
    }
    toggle(key) {
      this.flags[key] = !this.flags[key];
      this.flagBtns[key].classList.toggle('on', this.flags[key]);
      if (key === 'grid') this.redraw(); else this.drawOverlay();
    }

    buildSide() {
      if (!this.eng) return;
      const keepScroll = this.layerList ? this.layerList.scrollTop : 0;
      this.side.innerHTML = '';
      const add = el('button', { text: '+ Слой', title: 'Новый слой' });
      add.addEventListener('click', async () => {
        const r = await modal({ title: 'Новый слой', fields: [{ name: 'name', label: 'Имя слоя', value: `Слой${this.layers.length}` }], okText: 'Создать' });
        if (!r || !r.name) return;
        if (!this.eng.add_layer(r.name, UI.PALETTE[11 + (this.layers.length % 9)])) { toast('Слой с таким именем уже есть', 'error'); return; }
        this.curLayer = r.name;
        this.afterEdit();
      });
      const allOn = el('button', { text: 'Все', title: 'Показать все слои' });
      allOn.addEventListener('click', () => { this.layers.forEach((x) => this.eng.set_layer_visible(x.name, true)); this.refreshLayers(); this.buildSide(); this.redraw(); });
      const head = el('h4', {}, [el('span', { text: `Слои (${this.layers.length})` }), el('span', {}, [allOn, add])]);
      this.layerFilter = this.layerFilter || '';
      const search = el('input', { class: 'layer-search', type: 'search', placeholder: 'Найти слой…', value: this.layerFilter });
      search.addEventListener('input', () => { this.layerFilter = search.value; this.filterLayers(); });
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = this.layerList.querySelector('.layer-row:not([hidden])'); if (first) this.zoomToLayer(first.dataset.name); }
        if (e.key === 'Escape') { search.value = ''; this.layerFilter = ''; this.filterLayers(); this.wrap.focus(); }
        e.stopPropagation();
      });
      this.layerList = el('div', { class: 'layer-list' });
      this.layerRows = new Map();
      for (const l of this.layers) {
        const name = l.name;
        const sw = el('span', { class: 'lsw', style: { background: l.color, opacity: l.alpha != null && l.alpha < 255 ? Math.max(0.25, l.alpha / 255) : 1 }, title: 'Цвет слоя' + (l.alpha != null && l.alpha < 255 ? ` · прозрачность ${Math.round(100 - (l.alpha / 255) * 100)}%` : '') });
        sw.addEventListener('click', (e) => { e.stopPropagation(); UI.colorPicker(sw, { current: l.color, onPick: (c) => { this.eng.set_layer_color(name, c); this.afterEdit(); } }); });
        const go = el('button', { class: 'go', title: 'Показать слой на чертеже (двойной щелчок по строке)', html: icon('search') });
        go.addEventListener('click', (e) => { e.stopPropagation(); this.zoomToLayer(name); });
        const eye = el('button', { class: 'eye', title: l.visible ? 'Скрыть' : 'Показать', html: icon(l.visible ? 'eye' : 'eyeOff') });
        eye.addEventListener('click', (e) => { e.stopPropagation(); this.eng.set_layer_visible(name, !l.visible); this.refreshLayers(); this.buildSide(); this.redraw(); this.onDirty(); });
        const row = el('div', { class: 'layer-row' + (name === this.curLayer ? ' cur' : '') + (l.visible ? '' : ' off'), title: `${name}\nЩелчок — сделать текущим, двойной щелчок — показать на чертеже` }, [sw, el('span', { class: 'ln', text: name }), go, eye]);
        row.dataset.name = name;
        row.addEventListener('click', () => { this.curLayer = name; this.layerList.querySelectorAll('.layer-row.cur').forEach((r) => r.classList.remove('cur')); row.classList.add('cur'); });
        row.addEventListener('dblclick', () => this.zoomToLayer(name));
        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          UI.menu(e.clientX, e.clientY, [
            { label: 'Показать на чертеже', icon: 'search', onClick: () => this.zoomToLayer(name) },
            { label: 'Выделить объекты слоя', icon: 'cursor', onClick: () => this.selectLayer(name) },
            { label: 'Сделать текущим', icon: 'layers', onClick: () => { this.curLayer = name; this.buildSide(); } },
            '-',
            { label: 'Показать только этот слой', icon: 'eye', onClick: () => { this.layers.forEach((x) => this.eng.set_layer_visible(x.name, x.name === name)); this.refreshLayers(); this.buildSide(); this.redraw(); } },
            { label: 'Показать все слои', icon: 'eye', onClick: () => { this.layers.forEach((x) => this.eng.set_layer_visible(x.name, true)); this.refreshLayers(); this.buildSide(); this.redraw(); } },
            '-',
            { label: 'Переименовать…', icon: 'text', disabled: name === '0', onClick: async () => {
              const r = await modal({ title: 'Переименовать слой', fields: [{ name: 'n', label: 'Имя', value: name }] });
              if (!r || !r.n || r.n === name) return;
              if (!this.eng.rename_layer(name, r.n)) { toast('Не удалось переименовать', 'error'); return; }
              if (this.curLayer === name) this.curLayer = r.n;
              this.afterEdit();
            } },
            { label: 'Удалить слой с объектами', icon: 'trash', disabled: name === '0', onClick: () => { const n = this.eng.delete_layer(name); if (this.curLayer === name) this.curLayer = '0'; this.sel.clear(); this.afterEdit(); toast(`Удалён слой «${name}» и объектов: ${n}`); } },
          ]);
        });
        this.layerRows.set(name, row);
        this.layerList.append(row);
      }
      this.propsBox = el('div', { class: 'props-box' });
      this.side.append(el('div', { class: 'layers-box' }, [head, search, this.layerList]), this.propsBox);
      this.filterLayers();
      this.layerList.scrollTop = keepScroll;
      this.buildProps();
      this.markSelLayers(false);
    }
    filterLayers() {
      const q = (this.layerFilter || '').trim().toLowerCase();
      for (const [name, row] of this.layerRows || []) row.hidden = !!q && !name.toLowerCase().includes(q);
    }
    /** highlights the layers of the selected objects; with one layer it scrolls to it and makes it current */
    markSelLayers(scroll = true) {
      if (!this.layerRows) return;
      for (const r of this.layerRows.values()) r.classList.remove('sel');
      if (!this.sel.size) return;
      const ids = [...this.sel];
      let names = ids.length > 20000 ? [] : JSON.parse(this.eng.sel_summary(Uint32Array.from(ids))).layers;
      // one block picked: the layer of the line that was clicked inside it is more useful
      if (ids.length === 1 && this.pickedLayer && !names.includes(this.pickedLayer)) names = [this.pickedLayer];
      names.forEach((n) => { const r = this.layerRows.get(n); if (r) r.classList.add('sel'); });
      if (scroll && names.length) {
        const row = this.layerRows.get(names[0]);
        if (row) {
          if (row.hidden) { this.layerFilter = ''; const sInp = this.side.querySelector('.layer-search'); if (sInp) sInp.value = ''; this.filterLayers(); }
          row.scrollIntoView({ block: 'nearest' });
        }
      }
      if (names.length === 1 && names[0] !== this.curLayer) {
        this.curLayer = names[0];
        for (const [n, r] of this.layerRows) r.classList.toggle('cur', n === this.curLayer);
      }
    }
    /** zoom to the objects of a layer (shows the layer if it was hidden) */
    zoomToLayer(name) {
      const L = this.layers.find((l) => l.name === name);
      if (L && !L.visible) { this.eng.set_layer_visible(name, true); this.refreshLayers(); this.buildSide(); }
      const b = this.eng.layer_extents(name);
      if (!b.length) { toast(`На слое «${name}» нет объектов`); return; }
      this.zoomToBox(b);
      this.flashIds(this.eng.layer_ids(name));
    }
    zoomToBox(b) {
      const w = Math.max(b[2] - b[0], 1e-6), h = Math.max(b[3] - b[1], 1e-6);
      const s = Math.min((this.W * 0.85) / w, (this.H * 0.85) / h);
      this.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.min(s, 1e6) };
      this.redraw();
    }
    selectLayer(name) {
      const ids = this.eng.layer_ids(name);
      this.sel = new Set(ids);
      this.selChanged();
      toast(`Выделено объектов слоя «${name}»: ${ids.length.toLocaleString('ru')}`);
    }
    /** briefly select-highlight objects so the eye finds them, unless something is selected */
    flashIds(ids) {
      if (this.sel.size || !ids.length || ids.length > 200000) return;
      this.sel = new Set(ids);
      this.syncSel();
      this.renderNow();
      clearTimeout(this.flashT);
      this.flashT = setTimeout(() => { if (this.sel.size === ids.length) { this.sel.clear(); this.syncSel(); this.renderNow(); } }, 900);
    }
    zoomToSelection() {
      if (!this.sel.size) return;
      const b = this.eng.ids_extents(Uint32Array.from(this.sel));
      if (b.length) this.zoomToBox(b);
    }

    buildProps() {
      const box = this.propsBox;
      if (!box || !this.eng) return;
      box.innerHTML = '';
      const ids = [...this.sel];
      box.append(el('h4', { text: ids.length ? `Свойства (${ids.length.toLocaleString('ru')})` : 'Свойства' }));
      const grid = el('div', { class: 'props' });
      box.append(grid);
      if (!ids.length) {
        grid.append(el('div', { class: 'full', html: `Ничего не выделено.<br>Объектов: ${this.eng.count().toLocaleString('ru')}.<br><br>Щелчок — выбор, рамка слева направо — окно, справа налево — секущая. Колесо — зум, средняя или правая кнопка — панорама.` }));
        return;
      }
      const sum = JSON.parse(this.eng.sel_summary(Uint32Array.from(ids)));
      const types = { line: 'Отрезок', poly: 'Полилиния', circle: 'Окружность', arc: 'Дуга', ellipse: 'Эллипс', text: 'Текст', point: 'Точка', insert: 'Блок', hatch: 'Штриховка' };
      grid.append(el('label', { text: 'Тип' }), el('span', { text: sum.types.map((t) => types[t] || t).join(', ') }));
      const layerSel = el('select');
      if (sum.layers.length > 1) layerSel.append(el('option', { value: '', text: '*разные*' }));
      this.layers.forEach((l) => layerSel.append(el('option', { value: l.name, text: l.name })));
      layerSel.value = sum.layers.length === 1 ? sum.layers[0] : '';
      layerSel.addEventListener('change', () => layerSel.value && this.setProp('layer', layerSel.value));
      const layerCell = el('div', { class: 'prop-layer' }, [layerSel]);
      if (sum.layers.length === 1) {
        const goL = el('button', { class: 'prop-go', title: 'Найти слой в списке и показать его объекты', html: icon('layers') });
        goL.addEventListener('click', () => { const n = sum.layers[0]; const row = this.layerRows && this.layerRows.get(n); if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('pulse'); setTimeout(() => row.classList.remove('pulse'), 900); } });
        layerCell.append(goL);
      }
      grid.append(el('label', { text: 'Слой' }), layerCell);
      if (ids.length === 1 && this.pickedLayer && !sum.layers.includes(this.pickedLayer)) {
        const n = this.pickedLayer;
        const inner = el('button', { class: 'prop-inner', title: 'Слой линии, по которой вы щёлкнули внутри блока. Нажмите, чтобы показать его объекты.', text: n });
        inner.addEventListener('click', () => this.zoomToLayer(n));
        grid.append(el('label', { text: 'Внутри блока' }), inner);
      }
      const colSel = el('select');
      colSel.append(el('option', { value: '', text: 'По слою' }));
      const named = [['#ff0000', 'Красный'], ['#ffff00', 'Жёлтый'], ['#00ff00', 'Зелёный'], ['#00ffff', 'Голубой'], ['#0000ff', 'Синий'], ['#ff00ff', 'Пурпурный'], ['#ffffff', 'Белый'], ['#808080', 'Серый']];
      named.forEach(([v, t]) => colSel.append(el('option', { value: v, text: t })));
      const cur = sum.colors.length === 1 ? sum.colors[0] : '';
      if (cur && !named.some(([v]) => v === cur)) colSel.append(el('option', { value: cur, text: cur }));
      colSel.value = cur;
      colSel.addEventListener('change', () => this.setProp('color', colSel.value || null));
      grid.append(el('label', { text: 'Цвет' }), colSel);
      // lengths and areas of the selection (sums for several objects)
      if (sum.length > 0) grid.append(el('label', { text: ids.length > 1 ? 'Сумма длин' : 'Длина' }), el('span', { class: 'meas', text: this.fmtLen(sum.length) }));
      if (sum.areaCount > 0) grid.append(el('label', { text: sum.areaCount > 1 || ids.length > 1 ? `Площадь (${sum.areaCount})` : 'Площадь' }), el('span', { class: 'meas', text: this.fmtArea(sum.area) }));

      if (ids.length === 1) {
        const idx = ids[0];
        const e = this.ent(idx);
        const num = (label, get, set) => {
          const inp = el('input', { type: 'number', step: 'any', value: fmt(get()) });
          inp.addEventListener('change', () => { const v = parseFloat(inp.value); if (isFinite(v)) { const n = JSON.parse(JSON.stringify(e)); set(n, v); this.replace(idx, n); } });
          grid.append(el('label', { text: label }), inp);
        };
        if (e.type === 'line') {
          num('Начало X', () => e.p1.x, (n, v) => (n.p1.x = v)); num('Начало Y', () => e.p1.y, (n, v) => (n.p1.y = v));
          num('Конец X', () => e.p2.x, (n, v) => (n.p2.x = v)); num('Конец Y', () => e.p2.y, (n, v) => (n.p2.y = v));
          grid.append(el('label', { text: 'Угол' }), el('span', { text: fmt(((Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x) / D2R) + 360) % 360) + '°' }));
        } else if (e.type === 'circle' || e.type === 'arc') {
          num('Центр X', () => e.c.x, (n, v) => (n.c.x = v)); num('Центр Y', () => e.c.y, (n, v) => (n.c.y = v)); num('Радиус', () => e.r, (n, v) => (n.r = Math.abs(v)));
          if (e.type === 'arc') { num('Нач. угол', () => e.a0, (n, v) => (n.a0 = v)); num('Кон. угол', () => e.a1, (n, v) => (n.a1 = v)); }

        } else if (e.type === 'text') {
          const t = el('input', { type: 'text', value: e.text.replace(/\n/g, ' ⏎ ') });
          t.addEventListener('change', () => { const n = JSON.parse(JSON.stringify(e)); n.text = t.value.replace(/ ⏎ /g, '\n'); this.replace(idx, n); });
          grid.append(el('label', { text: 'Текст' }), t);
          num('Высота', () => e.h, (n, v) => (n.h = Math.abs(v) || n.h)); num('Поворот', () => e.rot || 0, (n, v) => (n.rot = v));
        } else if (e.type === 'poly') {
          grid.append(el('label', { text: 'Вершин' }), el('span', { text: String(e.pts.length) }));
          const cl = el('input', { type: 'checkbox' });
          cl.checked = !!e.closed; cl.style.width = 'auto'; cl.style.height = 'auto';
          cl.addEventListener('change', () => { const n = JSON.parse(JSON.stringify(e)); n.closed = cl.checked; this.replace(idx, n); });
          grid.append(el('label', { text: 'Замкнута' }), el('span', {}, cl));
        } else if (e.type === 'insert') {
          grid.append(el('label', { text: 'Блок' }), el('span', { text: e.block }));
          num('Точка X', () => e.p.x, (n, v) => (n.p.x = v)); num('Точка Y', () => e.p.y, (n, v) => (n.p.y = v)); num('Масштаб', () => e.sx, (n, v) => { n.sx = v; n.sy = v; }); num('Поворот', () => e.rot || 0, (n, v) => (n.rot = v));
          if (e.attribs && e.attribs.length) grid.append(el('div', { class: 'full', text: 'Атрибуты: ' + e.attribs.map((a) => a.text).join(', ') }));
        } else if (e.type === 'hatch') {
          grid.append(el('label', { text: 'Заливка' }), el('span', { text: e.solid ? 'сплошная' : 'узор' }), el('label', { text: 'Контуров' }), el('span', { text: String(e.loops.length) }));
        }
      }
    }

    // ------------------------------------------------------------ units / measuring
    /** drawing units: from $INSUNITS, otherwise guessed from the size of the drawing */
    unitName() {
      if (this.unitOverride) return this.unitOverride;
      if (this._unit) return this._unit;
      const u = this.eng ? this.eng.units() : 0;
      const map = { 4: 'мм', 5: 'см', 6: 'м', 7: 'км' };
      let unit = map[u] || '';
      // $INSUNITS is often wrong (site plans in metres saved as "mm"): typical text height tells
      const f = this.texts && this.texts.f;
      if (f && f.length && (unit === 'мм' || unit === '')) {
        const hs = [];
        for (let i = 2; i < f.length && hs.length < 4000; i += TS * Math.max(1, Math.floor(f.length / TS / 4000))) hs.push(f[i]);
        hs.sort((a, b) => a - b);
        const med = hs[hs.length >> 1];
        if (med > 0) unit = med < 15 ? 'м' : 'мм';
      }
      this._unit = unit || 'мм';
      return this._unit;
    }
    syncUnitBtn() { if (this.unitBtn) this.unitBtn.textContent = 'Единицы: ' + this.unitName(); }
    fmtLen(v) {
      const u = this.unitName();
      let s = fmt(v) + (u ? ' ' + u : '');
      if (u === 'мм' && v >= 1000) s += `  (${fmt(v / 1000)} м)`;
      return s;
    }
    fmtArea(v) {
      const u = this.unitName();
      if (u === 'мм') return `${fmt(v / 1e6)} м²  (${fmt(v)} мм²)`;
      if (u === 'см') return `${fmt(v / 1e4)} м²`;
      if (u === 'м') return `${fmt(v)} м²` + (v >= 10000 ? `  (${fmt(v / 10000)} га)` : '');
      return fmt(v) + (u ? ` ${u}²` : '');
    }
    areaOf(pts) {
      let a = 0, l = 0;
      for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; l += dist(p, q); }
      return { area: Math.abs(a) / 2, perim: l };
    }

    // ------------------------------------------------------------ find text
    find() {
      if (this.findBox) { this.findInput.focus(); this.findInput.select(); return; }
      this.findInput = el('input', { type: 'search', placeholder: 'Найти текст на чертеже…' });
      this.findCount = el('span', { class: 'fc' });
      const prev = el('button', { title: 'Предыдущий (Shift+Enter)', html: icon('up', 14) });
      const next = el('button', { title: 'Следующий (Enter)', html: icon('down', 14) });
      const close = el('button', { title: 'Закрыть (Esc)', html: icon('x', 14) });
      this.findList = el('div', { class: 'cad-find-list' });
      this.findBox = el('div', { class: 'cad-find' }, [el('div', { class: 'row' }, [this.findInput, this.findCount, prev, next, close]), this.findList]);
      this.wrap.parentElement.append(this.findBox);
      const run = () => this.findRun(this.findInput.value);
      this.findInput.addEventListener('input', () => { clearTimeout(this.findT); this.findT = setTimeout(run, 150); });
      this.findInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.findStep(e.shiftKey ? -1 : 1);
        if (e.key === 'Escape') this.closeFind();
      });
      prev.addEventListener('click', () => this.findStep(-1));
      next.addEventListener('click', () => this.findStep(1));
      close.addEventListener('click', () => this.closeFind());
      this.findInput.focus();
    }
    closeFind() { if (this.findBox) { this.findBox.remove(); this.findBox = null; this.findHits = []; this.findMark = null; this.drawOverlay(); this.wrap.focus({ preventScroll: true }); } }
    findRun(q) {
      q = q.trim().toLowerCase();
      this.findHits = [];
      this.findList.innerHTML = '';
      if (!q) { this.findCount.textContent = ''; this.findMark = null; this.drawOverlay(); return; }
      const f = this.texts.f, strs = this.texts.s;
      const n = Math.min(strs.length, f.length / TS);
      const L = this.layerByIndex;
      for (let i = 0; i < n; i++) {
        if (!strs[i].toLowerCase().includes(q)) continue;
        const layer = L[f[i * TS + 8]];
        this.findHits.push({ i, x: f[i * TS], y: f[i * TS + 1], h: f[i * TS + 2], text: strs[i], layer: layer ? layer.name : '' });
      }
      this.findCount.textContent = this.findHits.length ? `${this.findHits.length.toLocaleString('ru')}` : 'нет';
      this.findPos = -1;
      this.findHits.slice(0, 300).forEach((h, k) => {
        const row = el('div', { class: 'it' }, [el('span', { class: 't', text: h.text.replace(/\n/g, ' ') }), el('span', { class: 'l', text: h.layer })]);
        row.addEventListener('click', () => { this.findPos = k; this.findShow(); });
        this.findList.append(row);
      });
      if (this.findHits.length > 300) this.findList.append(el('div', { class: 'more', text: `…и ещё ${this.findHits.length - 300}. Уточните запрос.` }));
      if (this.findHits.length) { this.findPos = 0; this.findShow(); }
    }
    findStep(d) {
      if (!this.findHits || !this.findHits.length) return;
      this.findPos = (this.findPos + d + this.findHits.length) % this.findHits.length;
      this.findShow();
    }
    findShow() {
      const h = this.findHits[this.findPos];
      if (!h) return;
      const L = this.layerByIndex[this.texts.f[h.i * TS + 8]];
      if (L && !L.visible) { this.eng.set_layer_visible(L.name, true); this.refreshLayers(); this.buildSide(); }
      // zoom so that the text is about 18 px high
      this.view = { cx: h.x, cy: h.y, s: Math.max(this.view.s, Math.min(18 / h.h, 1e6)) };
      this.findMark = { x: h.x, y: h.y, h: h.h };
      [...this.findList.children].forEach((c, k) => c.classList.toggle('on', k === this.findPos));
      const on = this.findList.children[this.findPos];
      if (on) on.scrollIntoView({ block: 'nearest' });
      this.findCount.textContent = `${this.findPos + 1} из ${this.findHits.length.toLocaleString('ru')}`;
      this.redraw();
    }

    // ------------------------------------------------------------ view
    resize() {
      const r = this.wrap.getBoundingClientRect();
      if (!r.width || !r.height || !this.gl) return;
      this.dpr = window.devicePixelRatio || 1;
      this.W = r.width; this.H = r.height;
      for (const c of [this.bgCanvas, this.textCanvas, this.over]) { c.width = Math.round(r.width * this.dpr); c.height = Math.round(r.height * this.dpr); }
      this.gl.resize(r.width, r.height, this.dpr);
      this.redraw();
    }
    w2s(p) { return { x: (p.x - this.view.cx) * this.view.s + this.W / 2, y: this.H / 2 - (p.y - this.view.cy) * this.view.s }; }
    s2w(x, y) { return { x: (x - this.W / 2) / this.view.s + this.view.cx, y: (this.H / 2 - y) / this.view.s + this.view.cy }; }
    worldTransform(ctx) {
      const { cx, cy, s } = this.view, d = this.dpr;
      ctx.setTransform(d * s, 0, 0, -d * s, d * (this.W / 2 - cx * s), d * (this.H / 2 + cy * s));
    }
    gridStep() {
      const target = 18 / this.view.s;
      const p = Math.pow(10, Math.floor(Math.log10(target)));
      for (const k of [1, 2, 5, 10]) if (p * k >= target) return p * k;
      return p * 10;
    }
    redraw() {
      if (this.raf || !this.eng) return;
      this.raf = requestAnimationFrame(() => { this.raf = null; this.renderNow(); });
    }
    renderNow(theme) {
      if (!this.eng || !this.W) return;
      const th = theme || this.theme;
      this.drawBg(th, !theme);
      const layersArr = this.layerByIndex || [];
      const preview = this.selPreviewMatrix();
      this.gl.draw({ ...this.view, W: this.W, H: this.H }, this.origin, layersArr, hexRgb(th.fg), this.sel.size ? { matrix: preview, color: preview ? th.preview || [1, 0.82, 0.4] : th.sel || [0.3, 0.64, 1] } : null, this.colorMode(th));
      this.drawTexts(th);
      if (!theme) this.drawOverlay();
    }
    /** 0 colours as is, 1 darken light colours on a light background, 2 monochrome */
    colorMode(th) {
      if (this.colorOpts.mono) return 2;
      return th.light && this.colorOpts.darken ? 1 : 0;
    }
    visibleBox() { const a = this.s2w(0, this.H), b = this.s2w(this.W, 0); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }; }
    drawBg(th, grid) {
      const ctx = this.bgCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = th.bg;
      ctx.fillRect(0, 0, this.bgCanvas.width, this.bgCanvas.height);
      if (grid && this.flags.grid) this.drawGrid(ctx);
      if (grid && !this.eng.count() && !this.cmd) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = th.hint || '#6b7380';
        ctx.font = '14px Segoe UI, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Пустой чертёж — выберите инструмент сверху или введите команду внизу (например, L — отрезок)', this.W / 2, this.H / 2);
      }
    }
    drawGrid(ctx) {
      const step = this.gridStep();
      const v = this.visibleBox();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      const drawLines = (st, color) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = Math.ceil(v.x1 / st) * st; x <= v.x2; x += st) { const sx = Math.round(this.w2s({ x, y: 0 }).x) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, this.H); }
        for (let y = Math.ceil(v.y1 / st) * st; y <= v.y2; y += st) { const sy = Math.round(this.w2s({ x: 0, y }).y) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(this.W, sy); }
        ctx.stroke();
      };
      drawLines(step, this.theme.grid1);
      drawLines(step * 5, this.theme.grid2);
      const o = this.w2s({ x: 0, y: 0 });
      ctx.strokeStyle = this.theme.axis;
      ctx.beginPath(); ctx.moveTo(o.x + 0.5, 0); ctx.lineTo(o.x + 0.5, this.H); ctx.moveTo(0, o.y + 0.5); ctx.lineTo(this.W, o.y + 0.5); ctx.stroke();
      ctx.strokeStyle = '#ef476f'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(18, this.H - 18); ctx.lineTo(48, this.H - 18); ctx.stroke();
      ctx.strokeStyle = '#06d6a0';
      ctx.beginPath(); ctx.moveTo(18, this.H - 18); ctx.lineTo(18, this.H - 48); ctx.stroke();
      ctx.fillStyle = '#8a94a6'; ctx.font = '10px Segoe UI'; ctx.fillText('X', 52, this.H - 14); ctx.fillText('Y', 14, this.H - 52);
    }
    drawTexts(th) {
      const ctx = this.textCanvas.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.textCanvas.width, this.textCanvas.height);
      ctx.globalAlpha = 1;
      const f = this.texts.f, strs = this.texts.s;
      const n = Math.min(strs.length, f.length / TS);
      if (!n) return;
      const s = this.view.s, d = this.dpr;
      const v = this.visibleBox();
      const fgHex = th.fg;
      const L = this.layerByIndex;
      const mode = this.colorMode(th);
      const lh = 72 * 1.6;
      ctx.font = '100px Arial, "Segoe UI", sans-serif';
      let drawn = 0;
      for (let i = 0; i < n; i++) {
        const o = i * TS;
        const h = f[o + 2];
        if (h * s < 1.2) continue;
        const x = f[o], y = f[o + 1];
        const text = strs[i];
        const reach = h * (2 + text.length * 0.7 + (text.split('\n').length - 1) * 1.6);
        if (x + reach < v.x1 || x - reach > v.x2 || y + reach < v.y1 || y - reach > v.y2) continue;
        const layer = L[f[o + 8]];
        if (layer && !layer.visible) continue;
        const rgbNum = f[o + 9];
        const rawHex = rgbNum >= 0 ? '#' + rgbNum.toString(16).padStart(6, '0') : layer ? layer.hex : '#ffffff';
        let color = adjustCadColor(rawHex, fgHex, mode);
        const mask = f[o + 11];
        let maskHex = null;
        if (mask >= 0) {
          // white/black (ACI 7) adapt to what is behind them: the mask to the background, the text to the mask
          maskHex = mask === BG_MASK || mode >= 2 ? th.bg : adjustCadColor('#' + Math.round(mask).toString(16).padStart(6, '0'), fgHex, 0);
          if (isNeutral(rawHex) || mode >= 2) color = luminance(maskHex) > 0.5 ? '#000000' : '#ffffff';
        }
        const rot = f[o + 3], ha = f[o + 4], va = f[o + 5], mtext = f[o + 6] === 1, wf = f[o + 7] || 1;
        const sp = this.w2s({ x, y });
        const k = (h * s) / 72;
        ctx.setTransform(d * k * wf * Math.cos(-rot * D2R), d * k * wf * Math.sin(-rot * D2R), -d * k * Math.sin(-rot * D2R), d * k * Math.cos(-rot * D2R), d * sp.x, d * sp.y);
        ctx.fillStyle = color;
        ctx.globalAlpha = f[o + 10] >= 0 ? f[o + 10] / 255 : layer ? layer.alpha / 255 : 1;
        ctx.textAlign = ha === 1 || ha === 4 ? 'center' : ha === 2 ? 'right' : 'left';
        const lines = text.split('\n');
        let y0;
        if (mtext) {
          ctx.textBaseline = 'alphabetic';
          const H = 72 + (lines.length - 1) * lh;
          y0 = va === 3 ? 72 : va === 2 ? 72 - H / 2 : -(lines.length - 1) * lh;
        } else {
          ctx.textBaseline = va === 3 ? 'top' : va === 2 ? 'middle' : va === 1 ? 'bottom' : 'alphabetic';
          y0 = 0;
        }
        if (maskHex) {
          // MTEXT background mask: hides what lies under the text, like in AutoCAD
          let w = 0;
          for (const ln of lines) w = Math.max(w, ctx.measureText(ln).width);
          const pad = Math.max(0, (f[o + 12] || 1.5) - 1) * 36;
          const x0 = ctx.textAlign === 'center' ? -w / 2 : ctx.textAlign === 'right' ? -w : 0;
          const top = mtext ? y0 - 72 : va === 3 ? 0 : va === 2 ? -36 : -72;
          const bottom = (mtext ? y0 + (lines.length - 1) * lh : top + 72) + 18;
          const a0 = ctx.globalAlpha;
          ctx.globalAlpha = 1;
          ctx.fillStyle = maskHex;
          ctx.fillRect(x0 - pad, top - pad, w + 2 * pad, bottom - top + 2 * pad);
          ctx.globalAlpha = a0;
          ctx.fillStyle = color;
        }
        for (let j = 0; j < lines.length; j++) ctx.fillText(lines[j], 0, y0 + j * lh);
        if (++drawn > 30000) break;
      }
    }

    /** overlay: pencil marks, grips, rubber band previews, cursor */
    drawOverlay() {
      const ctx = this.over.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.over.width, this.over.height);
      if (!this.eng) return;
      if (this.findMark) {
        const m = this.findMark, sp = this.w2s(m);
        const r = Math.max(14, m.h * this.view.s * 1.2);
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.strokeStyle = '#ff9f1a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      if (this.areaMark && this.areaMark.length >= 3) {
        this.worldTransform(ctx);
        ctx.fillStyle = 'rgba(255, 159, 26, 0.25)'; ctx.strokeStyle = '#ff9f1a'; ctx.lineWidth = this.lw(ctx, 2);
        ctx.beginPath(); this.areaMark.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      // thick red pencil marks (also present in the GPU buffers at 1px)
      const inkVisible = !this.layers.some((l) => l.name === INK_LAYER && !l.visible);
      if (inkVisible && (this.ink.length || (this.inkLive && this.inkLive.length))) {
        this.worldTransform(ctx);
        ctx.strokeStyle = INK_RED; ctx.lineWidth = this.lw(ctx, 2.5); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        const a = this.ink;
        for (let i = 0; i < a.length; i += 4) { ctx.moveTo(a[i], a[i + 1]); ctx.lineTo(a[i + 2], a[i + 3]); }
        if (this.inkLive) this.inkLive.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
      // grips
      if (this.sel.size && this.sel.size <= 40 && (!this.cmd || this.cmd.name === 'select')) {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        for (const g of this.grips()) {
          const s = this.w2s(g.p);
          ctx.fillStyle = this.hotGrip === g.key ? '#ff4d4d' : '#3b82f6';
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1;
          ctx.fillRect(s.x - 4, s.y - 4, 8, 8);
          ctx.strokeRect(s.x - 4.5, s.y - 4.5, 9, 9);
        }
      }
      // command rubber band
      if (this.cmd && this.mouse.inside) {
        const prev = this.preview();
        if (prev) {
          this.worldTransform(ctx);
          for (const e of prev) this.drawPreview(ctx, e, e.__ghost ? this.theme.ghost : this.theme.accent);
        }
      }
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.win) {
        const crossing = this.win.x2 < this.win.x1;
        ctx.fillStyle = crossing ? 'rgba(46, 204, 113, .12)' : 'rgba(77, 163, 255, .12)';
        ctx.strokeStyle = crossing ? '#2ecc71' : SEL;
        ctx.setLineDash(crossing ? [5, 4] : []);
        const x = Math.min(this.win.x1, this.win.x2), y = Math.min(this.win.y1, this.win.y2), w = Math.abs(this.win.x2 - this.win.x1), h = Math.abs(this.win.y2 - this.win.y1);
        ctx.fillRect(x, y, w, h); ctx.strokeRect(x + 0.5, y + 0.5, w, h);
        ctx.setLineDash([]);
      }
      if (this.snapHit && this.mouse.inside) {
        const s = this.w2s(this.snapHit.p);
        ctx.strokeStyle = this.theme.accent; ctx.lineWidth = 2;
        const k = this.snapHit.kind;
        if (k === 'end') ctx.strokeRect(s.x - 6, s.y - 6, 12, 12);
        else if (k === 'mid') { ctx.beginPath(); ctx.moveTo(s.x, s.y - 7); ctx.lineTo(s.x + 7, s.y + 6); ctx.lineTo(s.x - 7, s.y + 6); ctx.closePath(); ctx.stroke(); }
        else if (k === 'cen') { ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, Math.PI * 2); ctx.stroke(); }
        else { ctx.beginPath(); ctx.moveTo(s.x - 6, s.y - 6); ctx.lineTo(s.x + 6, s.y + 6); ctx.moveTo(s.x + 6, s.y - 6); ctx.lineTo(s.x - 6, s.y + 6); ctx.stroke(); }
        const names = { end: 'Конечная точка', mid: 'Середина', cen: 'Центр', grid: 'Узел сетки', ins: 'Точка вставки' };
        ctx.font = '11px Segoe UI'; ctx.fillStyle = this.theme.accent; ctx.fillText(names[k] || '', s.x + 10, s.y - 10);
      }
      if (this.mouse.inside && !this.panning) {
        const { x, y } = this.mouse;
        const inkMode = this.cmd && ['pencil', 'inkerase'].includes(this.cmd.name);
        ctx.strokeStyle = this.theme.cross;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const L = this.cmd && this.cmd.name !== 'select' && !inkMode ? 2000 : 10;
        ctx.moveTo(Math.round(x) + 0.5, y - L); ctx.lineTo(Math.round(x) + 0.5, y + L);
        ctx.moveTo(x - L, Math.round(y) + 0.5); ctx.lineTo(x + L, Math.round(y) + 0.5);
        ctx.stroke();
        if (inkMode) { ctx.strokeStyle = '#ff4d4d'; ctx.beginPath(); ctx.arc(x, y, this.cmd.name === 'inkerase' ? 8 : 2.5, 0, Math.PI * 2); ctx.stroke(); }
        else if (!this.cmd || this.cmd.name === 'select') ctx.strokeRect(Math.round(x) - 4.5, Math.round(y) - 4.5, 9, 9);
        if (this.cmd && this.cmd.pts && this.cmd.pts.length && !inkMode) {
          const last = this.cmd.pts[this.cmd.pts.length - 1], cur = this.cursorWorld();
          const dd = dist(last, cur), a = ((Math.atan2(cur.y - last.y, cur.x - last.x) / D2R) + 360) % 360;
          ctx.font = '11px Consolas, monospace';
          const label = `${fmt(dd)} < ${a.toFixed(1)}°`;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(20,22,27,.85)'; ctx.fillRect(x + 14, y + 12, tw + 10, 18);
          ctx.fillStyle = '#cfe8ff'; ctx.fillText(label, x + 19, y + 25);
        }
      }
    }
    lw(ctx, px = 1) { const m = ctx.getTransform(); return (px * this.dpr) / Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)); }
    /** draws small temporary entities (command previews) on the overlay */
    drawPreview(ctx, e, color) {
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = this.lw(ctx, 1.5);
      ctx.beginPath();
      switch (e.type) {
        case 'line': ctx.moveTo(e.p1.x, e.p1.y); ctx.lineTo(e.p2.x, e.p2.y); break;
        case 'poly': {
          const n = e.pts.length;
          ctx.moveTo(e.pts[0].x, e.pts[0].y);
          for (let i = 0; i < (e.closed ? n : n - 1); i++) {
            const a = e.pts[i], b = e.pts[(i + 1) % n];
            if (a.b) { const arc = bulgeArc(a, b, a.b); ctx.arc(arc.c.x, arc.c.y, arc.r, arc.a0, arc.a1, !arc.ccw); } else ctx.lineTo(b.x, b.y);
          }
          if (e.closed) ctx.closePath();
          if (e.filled) { ctx.fill(); return; }
          break;
        }
        case 'circle': ctx.arc(e.c.x, e.c.y, e.r, 0, Math.PI * 2); break;
        case 'arc': ctx.arc(e.c.x, e.c.y, e.r, e.a0 * D2R, e.a1 * D2R, false); break;
        case 'text': {
          ctx.save();
          ctx.translate(e.p.x, e.p.y); ctx.rotate((e.rot || 0) * D2R);
          const k = e.h / 72; ctx.scale(k, -k);
          ctx.font = '100px Arial'; ctx.textAlign = e.halign === 1 ? 'center' : 'left'; ctx.textBaseline = e.valign === 3 ? 'top' : e.valign === 1 ? 'bottom' : 'alphabetic';
          ctx.fillText(e.text, 0, 0);
          ctx.restore();
          return;
        }
      }
      ctx.stroke();
    }

    // ------------------------------------------------------------ snapping
    findSnap(sx, sy) {
      const p = this.s2w(sx, sy);
      const tol = 10 / this.view.s;
      let best = null;
      if (this.flags.osnap) {
        const excl = this.cmd && this.cmd.excl ? Uint32Array.from(this.cmd.excl) : new Uint32Array(0);
        const r = this.eng.snap(p.x, p.y, tol, excl);
        let bd = tol;
        if (r.length) { best = { p: { x: r[0], y: r[1] }, kind: SNAP_KIND[r[2]] }; bd = dist(best.p, p); }
        if (this.cmd && this.cmd.pts) for (const q of this.cmd.pts) { const d = dist(q, p); if (d < bd) { bd = d; best = { p: q, kind: 'end' }; } }
      }
      if (!best && this.flags.snap) { const st = this.gridStep(); best = { p: { x: Math.round(p.x / st) * st, y: Math.round(p.y / st) * st }, kind: 'grid' }; }
      return best;
    }
    cursorWorld() {
      const p = this.snapHit ? { ...this.snapHit.p } : this.s2w(this.mouse.x, this.mouse.y);
      const c = this.cmd;
      if (this.flags.ortho && c && c.pts && c.pts.length && !(this.snapHit && this.snapHit.kind !== 'grid') && ['line', 'pline', 'move', 'copy', 'dim', 'measure', 'mirror'].includes(c.name)) {
        const last = c.pts[c.pts.length - 1];
        if (Math.abs(p.x - last.x) > Math.abs(p.y - last.y)) p.y = last.y; else p.x = last.x;
      }
      return p;
    }

    // ------------------------------------------------------------ grips
    grips() {
      const out = [];
      for (const i of this.sel) {
        const e = this.ent(i);
        if (!e) continue;
        const add = (p, apply) => out.push({ key: `${i}:${out.length}`, i, p, apply });
        switch (e.type) {
          case 'line':
            add(e.p1, (n, q) => (n.p1 = q)); add(e.p2, (n, q) => (n.p2 = q));
            add(lerp(e.p1, e.p2, 0.5), (n, q) => { const m = lerp(e.p1, e.p2, 0.5), dx = q.x - m.x, dy = q.y - m.y; n.p1 = { x: e.p1.x + dx, y: e.p1.y + dy }; n.p2 = { x: e.p2.x + dx, y: e.p2.y + dy }; });
            break;
          case 'poly': if (e.pts.length <= 200) e.pts.forEach((p, k) => add(p, (n, q) => { n.pts[k].x = q.x; n.pts[k].y = q.y; })); break;
          case 'circle': case 'arc': add(e.c, (n, q) => (n.c = q)); add({ x: e.c.x + e.r, y: e.c.y }, (n, q) => (n.r = dist(q, e.c))); break;
          case 'ellipse': add(e.c, (n, q) => (n.c = q)); break;
          case 'text': case 'point': case 'insert': add(e.p, (n, q) => {
            if (n.type === 'insert' && n.attribs) { const dx = q.x - n.p.x, dy = q.y - n.p.y; n.attribs.forEach((a) => { a.p.x += dx; a.p.y += dy; }); }
            n.p = q;
          }); break;
        }
      }
      return out;
    }
    gripAt(sx, sy) { return this.grips().find((g) => { const s = this.w2s(g.p); return Math.abs(s.x - sx) <= 6 && Math.abs(s.y - sy) <= 6; }); }

    // ------------------------------------------------------------ commands
    startCmd(name) {
      this.input.value = '';
      if (!this.eng) return;
      if (name === 'select' || !name) { this.cmd = null; this.setPrompt('Команда:'); this.syncCmdBtns(); this.renderNow(); return; }
      if (['move', 'copy', 'rotate', 'mirror'].includes(name) && !this.sel.size) {
        this.cmd = { name: 'pickfor', then: name, pts: [] };
        this.setPrompt('Выберите объекты и нажмите Enter:');
        this.syncCmdBtns(name);
        return;
      }
      this.areaMark = null;
      if (name !== 'pencil' && name !== 'inkerase') this.lastCmd = name;
      this.cmd = { name, pts: [], excl: ['move', 'copy', 'rotate', 'mirror'].includes(name) ? new Set(this.sel) : null };
      const prompts = {
        line: 'ОТРЕЗОК  Первая точка:', pline: 'ПОЛИЛИНИЯ  Начальная точка:', rect: 'ПРЯМОУГОЛЬНИК  Первый угол:', circle: 'КРУГ  Центр:',
        arc: 'ДУГА  Начальная точка:', text: 'ТЕКСТ  Точка вставки:', dim: 'РАЗМЕР  Первая точка:', measure: 'ИЗМЕРИТЬ  Первая точка:', printwin: 'ПЕЧАТЬ  Первый угол области:', area: 'ПЛОЩАДЬ  Укажите вершины контура (Enter — посчитать; Enter сразу — площадь выделенных объектов):',
        pencil: 'КАРАНДАШ  Рисуйте мышью поверх чертежа (Esc — выход):', inkerase: 'ЛАСТИК  Проведите по красным пометкам, чтобы стереть (Esc — выход):',
        move: 'ПЕРЕНЕСТИ  Базовая точка:', copy: 'КОПИРОВАТЬ  Базовая точка:', rotate: 'ПОВЕРНУТЬ  Базовая точка:', mirror: 'ЗЕРКАЛО  Первая точка оси:',
      };
      this.setPrompt(prompts[name] || name);
      this.syncCmdBtns(name);
      this.wrap.focus({ preventScroll: true });
      this.drawOverlay();
    }
    syncCmdBtns(name) { this.cmdBtns.forEach((b) => b.classList.toggle('on', b.dataset.cmd === (name || (this.cmd ? this.cmd.name : 'select')))); }
    setPrompt(t) { this.prompt.textContent = t; }

    addPoint(p) {
      const c = this.cmd;
      if (!c) return;
      c.pts.push(p);
      const n = c.pts.length;
      switch (c.name) {
        case 'line':
          if (n >= 2) this.add([this.newEnt({ type: 'line', p1: c.pts[n - 2], p2: c.pts[n - 1] })]);
          this.setPrompt('ОТРЕЗОК  Следующая точка (Enter/Esc — завершить, U — отменить):');
          break;
        case 'pline': this.setPrompt('ПОЛИЛИНИЯ  Следующая точка (Enter — завершить, C — замкнуть):'); break;
        case 'rect':
          if (n === 2) {
            const [a, b] = c.pts;
            this.add([this.newEnt({ type: 'poly', closed: true, pts: [{ x: a.x, y: a.y, b: 0 }, { x: b.x, y: a.y, b: 0 }, { x: b.x, y: b.y, b: 0 }, { x: a.x, y: b.y, b: 0 }] })]);
            this.repeatCmd();
          } else this.setPrompt('ПРЯМОУГОЛЬНИК  Второй угол (или @ширина,высота):');
          break;
        case 'circle':
          if (n === 2) { this.add([this.newEnt({ type: 'circle', c: c.pts[0], r: dist(c.pts[0], c.pts[1]) })]); this.repeatCmd(); }
          else this.setPrompt('КРУГ  Радиус (точка или число):');
          break;
        case 'arc':
          if (n === 3) {
            const a = threePointArc(...c.pts);
            if (a) this.add([this.newEnt({ type: 'arc', ...a })]); else toast('Точки лежат на одной прямой', 'error');
            this.repeatCmd();
          } else this.setPrompt(n === 1 ? 'ДУГА  Вторая точка:' : 'ДУГА  Конечная точка:');
          break;
        case 'text': this.textAt(p); break;
        case 'measure':
          if (n === 2) {
            const [a, b] = c.pts;
            const msg = `Расстояние: ${fmt(dist(a, b))}   ΔX: ${fmt(b.x - a.x)}   ΔY: ${fmt(b.y - a.y)}   Угол: ${(((Math.atan2(b.y - a.y, b.x - a.x) / D2R) + 360) % 360).toFixed(2)}°`;
            toast(msg, null, 8000);
            this.info.textContent = msg;
            this.startCmd(null);
          } else this.setPrompt('ИЗМЕРИТЬ  Вторая точка:');
          break;
        case 'printwin':
          if (n === 2) {
            const [a, b] = c.pts;
            this.printRegion = [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
            this.startCmd(null);
            this.printDialog(this.printRegion);
          } else this.setPrompt('ПЕЧАТЬ  Второй угол области:');
          break;
        case 'area': {
          if (n >= 3) { const r = this.areaOf(c.pts); this.setPrompt(`ПЛОЩАДЬ  ${this.fmtArea(r.area)} · периметр ${this.fmtLen(r.perim)}   (следующая вершина или Enter)`); }
          else this.setPrompt('ПЛОЩАДЬ  Следующая вершина:');
          break;
        }
        case 'dim':
          if (n === 3) { this.makeDim(...c.pts); this.repeatCmd(); }
          else this.setPrompt(n === 1 ? 'РАЗМЕР  Вторая точка:' : 'РАЗМЕР  Положение размерной линии:');
          break;
        case 'move': case 'copy':
          if (n === 2) {
            const m = Mx.translate(c.pts[1].x - c.pts[0].x, c.pts[1].y - c.pts[0].y);
            this.transformSel(m, c.name === 'copy');
            if (c.name === 'copy') { c.pts = [c.pts[0]]; this.setPrompt('КОПИРОВАТЬ  Вторая точка (Enter — завершить):'); }
            else this.startCmd(null);
          } else this.setPrompt(c.name === 'move' ? 'ПЕРЕНЕСТИ  Вторая точка (или @dx,dy):' : 'КОПИРОВАТЬ  Вторая точка (или @dx,dy):');
          break;
        case 'rotate':
          if (n === 2) { const a = Math.atan2(c.pts[1].y - c.pts[0].y, c.pts[1].x - c.pts[0].x) / D2R; this.transformSel(Mx.rotateAbout(c.pts[0], a), false); this.startCmd(null); }
          else this.setPrompt('ПОВЕРНУТЬ  Угол поворота (точка или градусы):');
          break;
        case 'mirror':
          if (n === 2) {
            this.transformSel(Mx.mirror(c.pts[0], c.pts[1]), true);
            toast('Зеркальная копия создана. Исходные объекты сохранены — удалите их при необходимости (Del).');
            this.startCmd(null);
          } else this.setPrompt('ЗЕРКАЛО  Вторая точка оси:');
          break;
      }
      this.renderNow();
    }
    repeatCmd() { const name = this.cmd.name; this.cmd = null; this.startCmd(name); }
    finishCmd() {
      const c = this.cmd;
      if (!c) return;
      if (c.name === 'pline' && c.pts.length >= 2) this.add([this.newEnt({ type: 'poly', closed: !!c.close, pts: c.pts.map((p) => ({ x: p.x, y: p.y, b: 0 })) })]);
      if (c.name === 'pickfor') { const then = c.then; this.cmd = null; if (this.sel.size) this.startCmd(then); else this.startCmd(null); return; }
      if (c.name === 'area') {
        let msg;
        if (c.pts.length >= 3) {
          const r = this.areaOf(c.pts);
          msg = `Площадь: ${this.fmtArea(r.area)}   Периметр: ${this.fmtLen(r.perim)}`;
          this.areaMark = c.pts.slice();
        } else if (this.sel.size) {
          const sum = JSON.parse(this.eng.sel_summary(Uint32Array.from(this.sel)));
          msg = sum.areaCount ? `Площадь ${sum.areaCount} объект(ов): ${this.fmtArea(sum.area)}   Длина контуров: ${this.fmtLen(sum.length)}` : 'Среди выделенных нет замкнутых контуров (замкнутая полилиния, круг, штриховка)';
        } else msg = 'Укажите хотя бы 3 вершины или сначала выделите замкнутые объекты';
        toast(msg, null, 10000);
        this.info.textContent = msg;
      }
      this.startCmd(null);
    }
    /** live move/rotate/mirror preview: the selection outline is transformed on the GPU */
    selPreviewMatrix() {
      const c = this.cmd;
      if (!c || !c.pts || !c.pts.length || !this.mouse.inside) return null;
      const p = this.cursorWorld(), a = c.pts[0];
      if (c.name === 'move' || c.name === 'copy') return Mx.translate(p.x - a.x, p.y - a.y);
      if (c.name === 'rotate') return Mx.rotateAbout(a, Math.atan2(p.y - a.y, p.x - a.x) / D2R);
      if (c.name === 'mirror' && dist(a, p) > 0) return Mx.mirror(a, p);
      return null;
    }
    preview() {
      const c = this.cmd;
      if (!c || !c.pts || !c.pts.length) return null;
      const p = this.cursorWorld();
      const a = c.pts[c.pts.length - 1];
      switch (c.name) {
        case 'line': case 'measure': return [{ type: 'line', p1: a, p2: p }];
        case 'printwin': return [{ type: 'poly', closed: true, pts: [{ x: a.x, y: a.y }, { x: p.x, y: a.y }, { x: p.x, y: p.y }, { x: a.x, y: p.y }] }];
        case 'area': return [{ type: 'poly', closed: c.pts.length >= 2, pts: [...c.pts, p].map((q) => ({ ...q, b: 0 })) }];
        case 'pline': return [{ type: 'poly', pts: [...c.pts, p].map((q) => ({ ...q, b: 0 })), closed: false }];
        case 'rect': return [{ type: 'poly', closed: true, pts: [{ x: a.x, y: a.y }, { x: p.x, y: a.y }, { x: p.x, y: p.y }, { x: a.x, y: p.y }] }];
        case 'circle': return [{ type: 'circle', c: a, r: dist(a, p) }, { type: 'line', p1: a, p2: p, __ghost: true }];
        case 'arc': { if (c.pts.length === 1) return [{ type: 'line', p1: a, p2: p }]; const arc = threePointArc(c.pts[0], c.pts[1], p); return arc ? [{ type: 'arc', ...arc }] : null; }
        case 'dim': { if (c.pts.length === 1) return [{ type: 'line', p1: a, p2: p }]; return this.dimEntities(c.pts[0], c.pts[1], p); }
        case 'move': case 'copy': case 'rotate': case 'mirror': return [{ type: 'line', p1: c.pts[0], p2: p, __ghost: true }];
      }
      return null;
    }

    async textAt(p) {
      const r = await modal({
        title: 'Текст', okText: 'Вставить',
        fields: [{ name: 'text', label: 'Текст (можно в несколько строк)', type: 'textarea', value: '' }, { name: 'h', label: 'Высота', type: 'number', value: this.textH || +(+(14 / this.view.s).toPrecision(2)) }, { name: 'rot', label: 'Поворот, °', type: 'number', value: 0 }],
      });
      if (r && r.text.trim()) {
        this.textH = r.h > 0 ? r.h : this.textH;
        const multi = r.text.includes('\n');
        this.add([this.newEnt({ type: 'text', p, h: r.h > 0 ? r.h : 2.5, text: r.text.replace(/\s+$/, ''), rot: r.rot || 0, halign: 0, valign: multi ? 3 : 0, mtext: multi })]);
      }
      this.startCmd(null);
      this.wrap.focus();
    }

    dimEntities(a, b, pos) {
      const L = dist(a, b);
      if (L < 1e-9) return [];
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      const nx = -uy, ny = ux;
      const off = (pos.x - a.x) * nx + (pos.y - a.y) * ny;
      const A = { x: a.x + nx * off, y: a.y + ny * off }, B = { x: b.x + nx * off, y: b.y + ny * off };
      const sign = Math.sign(off) || 1;
      const h = this.textH || Math.max(L * 0.04, 0.0001);
      const gap = Math.min(h * 0.4, Math.abs(off) * 0.2), over = h * 0.6;
      const ext = (p, q) => ({ type: 'line', p1: { x: p.x + nx * sign * gap, y: p.y + ny * sign * gap }, p2: { x: q.x + nx * sign * over, y: q.y + ny * sign * over } });
      const t = Math.min(h * 0.9, L * 0.15);
      const arrow = (p, dir) => ({ type: 'poly', closed: true, filled: true, pts: [{ x: p.x, y: p.y, b: 0 }, { x: p.x + dir * ux * t + nx * t * 0.3, y: p.y + dir * uy * t + ny * t * 0.3, b: 0 }, { x: p.x + dir * ux * t - nx * t * 0.3, y: p.y + dir * uy * t - ny * t * 0.3, b: 0 }] });
      let ang = Math.atan2(uy, ux) / D2R;
      if (ang > 90.01 || ang < -89.99) ang += 180;
      const mid = lerp(A, B, 0.5);
      const upx = -Math.sin(ang * D2R), upy = Math.cos(ang * D2R);
      const above = upx * nx * sign + upy * ny * sign >= 0;
      const txt = { type: 'text', p: { x: mid.x + nx * sign * h * 0.4, y: mid.y + ny * sign * h * 0.4 }, h, text: fmt(+L.toFixed(2)), rot: ang, halign: 1, valign: above ? 1 : 3 };
      return [ext(a, A), ext(b, B), { type: 'line', p1: A, p2: B }, arrow(A, 1), arrow(B, -1), txt];
    }
    makeDim(a, b, pos) {
      const ents = this.dimEntities(a, b, pos).map((e) => ({ ...e, layer: '0' }));
      if (!ents.length) return;
      let name;
      do { name = `DIM_${++this.dimN}`; } while (this.eng.has_block(name));
      this.eng.add_block(name, 0, 0, JSON.stringify(ents));
      this.add([this.newEnt({ type: 'insert', block: name, p: { x: 0, y: 0 }, sx: 1, sy: 1, rot: 0 })]);
    }

    // ------------------------------------------------------------ red pencil
    drawInk(e) {
      const r = this.over.getBoundingClientRect();
      const toW = (ev) => { const w = this.s2w(ev.clientX - r.left, ev.clientY - r.top); return [w.x, w.y]; };
      Ink.capture(e, toW, (pts) => { this.inkLive = pts; this.drawOverlay(); }, (pts) => {
        this.inkLive = null;
        let s = Ink.simplify(pts, 0.7 / this.view.s);
        if (s.length === 1) s = [s[0], [s[0][0] + 0.5 / this.view.s, s[0][1]]];
        let steps = 0;
        if (!this.layers.some((l) => l.name === INK_LAYER)) { this.eng.add_layer(INK_LAYER, INK_RED); steps++; }
        else this.eng.set_layer_visible(INK_LAYER, true);
        this.eng.add_json(JSON.stringify([{ layer: INK_LAYER, color: INK_RED, type: 'poly', closed: false, pts: s.map(([x, y]) => ({ x, y, b: 0 })) }]));
        steps++;
        if (steps > 1) this.eng.merge_last(steps);
        this.afterEdit();
      });
    }
    eraseInk(e) {
      const r = this.over.getBoundingClientRect();
      let removed = 0;
      const at = (ev) => {
        const p = this.s2w(ev.clientX - r.left, ev.clientY - r.top);
        const tol = 8 / this.view.s;
        let id;
        let hit = false;
        while ((id = this.eng.pick_on_layer(p.x, p.y, tol, INK_LAYER)) >= 0) { this.eng.erase(Uint32Array.of(id)); removed++; hit = true; }
        if (hit) { this.gl.hide(this.eng.take_hidden()); this.reloadInk(); this.renderNow(); }
      };
      at(e);
      const move = (ev) => at(ev);
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        if (removed) { this.eng.merge_last(removed); this.sel.clear(); this.afterEdit(); }
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    clearInk() {
      const n = this.eng.layer_count_of(INK_LAYER);
      if (!n && !this.layers.some((l) => l.name === INK_LAYER)) { toast('Пометок нет'); return; }
      this.eng.delete_layer(INK_LAYER);
      if (this.curLayer === INK_LAYER) this.curLayer = '0';
      this.sel.clear();
      this.afterEdit();
      toast(`Удалено пометок: ${n}. Отменить — Ctrl+Z`);
    }

    // ------------------------------------------------------------ edits
    transformSel(m, copy) {
      const ids = this.eng.transform(Uint32Array.from(this.sel), m, copy);
      if (copy) { this.sel = new Set(ids); if (this.cmd) this.cmd.excl = new Set(ids); }
      this.afterEdit();
    }
    replace(i, n) { this.eng.replace_json(i, JSON.stringify(n)); this.afterEdit(); }
    setProp(key, v) {
      if (!this.sel.size) return;
      const ids = Uint32Array.from(this.sel);
      if (key === 'layer') this.eng.set_layer_of(ids, v); else this.eng.set_color_of(ids, v || '');
      this.afterEdit();
    }
    erase() {
      if (!this.sel.size) { toast('Сначала выделите объекты'); return; }
      this.eng.erase(Uint32Array.from(this.sel));
      this.sel.clear();
      this.afterEdit();
    }
    undo() { if (this.eng && this.eng.undo()) { this.sel.clear(); this.afterEdit(); } }
    redo() { if (this.eng && this.eng.redo()) { this.sel.clear(); this.afterEdit(); } }
    selChanged() {
      this.syncSel();
      this.buildProps();
      this.markSelLayers(true);
      this.renderNow();
      this.info.textContent = this.sel.size ? `Выделено: ${this.sel.size.toLocaleString('ru')}` : '';
    }
    zoomExtents() {
      const b = this.eng.view_extents(true);
      if (b.length && b[4] > 0 && !this.strayNoted) { this.strayNoted = true; UI.toast(`Не учтено при «Показать всё»: ${b[4]} объект(ов) далеко за пределами чертежа`, null, 5000); }
      if (!b.length) { this.view = { cx: 148, cy: 105, s: Math.min(this.W / 340, this.H / 250) || 2 }; this.redraw(); return; }
      const w = Math.max(b[2] - b[0], 1e-6), h = Math.max(b[3] - b[1], 1e-6);
      this.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: Math.min((this.W * 0.9) / w, (this.H * 0.9) / h) };
      this.redraw();
    }

    // typed input in the command line
    handleInput(raw) {
      const s = raw.trim();
      this.input.value = '';
      const up = s.toUpperCase();
      const c = this.cmd;
      if (!s) { if (c) return this.finishCmd(); if (this.lastCmd) return this.startCmd(this.lastCmd); return; }
      if (c && c.name !== 'pickfor') {
        const last = c.pts[c.pts.length - 1];
        const num = s.replace(',', '.');
        if (c.name === 'pline' && (up === 'C' || up === 'З')) { c.close = true; return this.finishCmd(); }
        if ((c.name === 'line' || c.name === 'pline') && (up === 'U' || up === 'О')) { if (c.pts.length) { c.pts.pop(); if (c.name === 'line' && c.pts.length) this.undo(); } return this.drawOverlay(); }
        if (c.name === 'circle' && c.pts.length === 1 && /^[-+]?\d*\.?\d+$/.test(num)) return this.addPoint({ x: last.x + Math.abs(+num), y: last.y });
        if (c.name === 'rotate' && c.pts.length === 1 && /^[-+]?\d*\.?\d+$/.test(num)) { this.transformSel(Mx.rotateAbout(c.pts[0], +num), false); return this.startCmd(null); }
        let m;
        if ((m = /^@\s*([-+]?[\d.]+)\s*[,;]\s*([-+]?[\d.]+)$/.exec(s)) && last) return this.addPoint({ x: last.x + +m[1], y: last.y + +m[2] });
        if ((m = /^@\s*([-+]?[\d.]+)\s*<\s*([-+]?[\d.]+)$/.exec(s)) && last) return this.addPoint({ x: last.x + +m[1] * Math.cos(+m[2] * D2R), y: last.y + +m[1] * Math.sin(+m[2] * D2R) });
        if ((m = /^([-+]?[\d.]+)\s*[,;]\s*([-+]?[\d.]+)$/.exec(s))) return this.addPoint({ x: +m[1], y: +m[2] });
        if (/^[-+]?\d*\.?\d+$/.test(num) && last) {
          const cur = this.cursorWorld();
          const L = dist(last, cur) || 1;
          return this.addPoint({ x: last.x + ((cur.x - last.x) / L) * +num, y: last.y + ((cur.y - last.y) / L) * +num });
        }
        toast('Не понял ввод. Примеры: 100,50   @20,0   @50<45   или число — длина по направлению курсора', 'error', 5000);
        return;
      }
      const map = {
        L: 'line', LINE: 'line', 'ОТРЕЗОК': 'line', PL: 'pline', PLINE: 'pline', REC: 'rect', RECT: 'rect', RECTANG: 'rect', C: 'circle', CIRCLE: 'circle', 'КРУГ': 'circle',
        A: 'arc', ARC: 'arc', 'ДУГА': 'arc', T: 'text', TEXT: 'text', DT: 'text', MT: 'text', MTEXT: 'text', 'ТЕКСТ': 'text', M: 'move', MOVE: 'move', 'ПЕРЕНЕСТИ': 'move', CO: 'copy', CP: 'copy', COPY: 'copy',
        'КОПИРОВАТЬ': 'copy', RO: 'rotate', ROTATE: 'rotate', 'ПОВЕРНУТЬ': 'rotate', MI: 'mirror', MIRROR: 'mirror', 'ЗЕРКАЛО': 'mirror', DIM: 'dim', DLI: 'dim', DAL: 'dim', DI: 'measure', DIST: 'measure', AREA: 'area', AA: 'area', 'ПЛОЩАДЬ': 'area', 'ПЛ': 'area',
      };
      if (map[up]) return this.startCmd(map[up]);
      if (up === 'E' || up === 'ERASE' || up === 'СОТРИ') return this.erase();
      if (up === 'Z' || up === 'ZE' || up === 'ZOOM') return this.zoomExtents();
      if (up === 'U' || up === 'UNDO') return this.undo();
      if (up === 'LA' || up === 'LAYER') return this.side.querySelector('h4 button').click();
      toast(`Неизвестная команда: ${s}`, 'error');
    }

    // ------------------------------------------------------------ events
    bind() {
      const o = this.over;
      const pos = (e) => { const r = o.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      o.addEventListener('wheel', (e) => {
        e.preventDefault();
        const p = pos(e);
        const before = this.s2w(p.x, p.y);
        this.view.s = Math.max(1e-12, Math.min(1e12, this.view.s * Math.pow(1.0015, -e.deltaY)));
        const after = this.s2w(p.x, p.y);
        this.view.cx += before.x - after.x;
        this.view.cy += before.y - after.y;
        this.redraw();
      }, { passive: false });
      o.addEventListener('mouseenter', () => { this.mouse.inside = true; });
      o.addEventListener('mouseleave', () => { this.mouse.inside = false; this.drawOverlay(); });
      o.addEventListener('dblclick', (e) => {
        if (e.button === 1) return this.zoomExtents();
        if (this.cmd && this.cmd.name === 'pline') return this.finishCmd();
        const p = pos(e), w = this.s2w(p.x, p.y);
        const i = this.eng.pick(w.x, w.y, 6 / this.view.s);
        if (i >= 0 && this.ent(i).type === 'text') { this.sel = new Set([i]); this.selChanged(); this.editText(i); }
      });
      o.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });
      o.addEventListener('contextmenu', (e) => e.preventDefault());
      o.addEventListener('mousedown', (e) => {
        this.wrap.focus({ preventScroll: true });
        const p = pos(e);
        if (e.button === 1 || e.button === 2) return this.startPan(e, p);
        if (e.button !== 0) return;
        if (this.cmd && this.cmd.name === 'pencil') return this.drawInk(e);
        if (this.cmd && this.cmd.name === 'inkerase') return this.eraseInk(e);
        if (this.cmd && this.cmd.name !== 'pickfor') return this.addPoint(this.cursorWorld());
        const g = !this.cmd && this.gripAt(p.x, p.y);
        if (g) return this.dragGrip(g);
        const w = this.s2w(p.x, p.y);
        const hit = this.eng.pick(w.x, w.y, 6 / this.view.s);
        // the layer of the actual line under the cursor, even inside a block
        this.pickedLayer = hit >= 0 ? this.eng.pick_layer(w.x, w.y, 6 / this.view.s) || null : null;
        if (hit >= 0) {
          if (e.shiftKey && this.sel.has(hit)) this.sel.delete(hit);
          else { if (!e.shiftKey && !e.ctrlKey && !(this.cmd && this.cmd.name === 'pickfor')) this.sel.clear(); this.sel.add(hit); }
          this.selChanged();
          return;
        }
        this.winSelect(e, p);
      });
      o.addEventListener('mousemove', (e) => {
        const p = pos(e);
        this.mouse.x = p.x; this.mouse.y = p.y; this.mouse.inside = true;
        this.snapHit = this.cmd && !['pickfor', 'pencil', 'inkerase'].includes(this.cmd.name) ? this.findSnap(p.x, p.y) : null;
        const w = this.cursorWorld();
        this.coords.textContent = `X: ${fmt(w.x)}   Y: ${fmt(w.y)}`;
        const g = !this.cmd && this.sel.size && this.sel.size <= 40 ? this.gripAt(p.x, p.y) : null;
        this.hotGrip = g ? g.key : null;
        if (this.selPreviewMatrix()) this.renderNow(); else this.drawOverlay();
      });
      this.wrap.addEventListener('keydown', (e) => this.onKey(e));
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || (e.key === ' ' && !this.cmd)) { e.preventDefault(); this.handleInput(this.input.value); this.wrap.focus({ preventScroll: true }); }
        else if (e.key === 'Escape') { e.preventDefault(); this.input.value = ''; this.cancel(); this.wrap.focus({ preventScroll: true }); }
      });
    }
    onKey(e) {
      if (e.target === this.input || !this.eng) return;
      const k = e.key;
      const ctrl = e.ctrlKey || e.metaKey;
      if (k === 'F3') { e.preventDefault(); return this.toggle('osnap'); }
      if (k === 'F7') { e.preventDefault(); return this.toggle('grid'); }
      if (k === 'F8') { e.preventDefault(); return this.toggle('ortho'); }
      if (k === 'F9') { e.preventDefault(); return this.toggle('snap'); }
      if (ctrl && (k.toLowerCase() === 'p' || k === 'з')) { e.preventDefault(); return this.printDialog(); }
      if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); this.sel = new Set(this.eng.select_window(-1e300, -1e300, 1e300, 1e300, true)); return this.selChanged(); }
      if (ctrl && k.toLowerCase() === 'c' && this.sel.size) { e.preventDefault(); this.clip = JSON.parse(this.eng.entities_json(Uint32Array.from(this.sel))); toast(`Скопировано: ${this.clip.length.toLocaleString('ru')}`); return; }
      if (ctrl && k.toLowerCase() === 'v' && this.clip) {
        e.preventDefault();
        const off = 20 / this.view.s;
        const ids = this.eng.add_json(JSON.stringify(this.clip));
        this.eng.transform(ids, Mx.translate(off, -off), false);
        this.eng.merge_last(2);
        this.sel = new Set(ids);
        this.afterEdit();
        return;
      }
      if (ctrl) return;
      if (k === 'Escape') { e.preventDefault(); return this.cancel(); }
      if (k === 'Delete') { e.preventDefault(); return this.erase(); }
      if (k === 'Enter') { e.preventDefault(); return this.handleInput(this.input.value); }
      if (k === ' ' && !this.input.value) { e.preventDefault(); return this.handleInput(''); }
      if (k === 'Backspace') { e.preventDefault(); this.input.value = this.input.value.slice(0, -1); return; }
      if (k.length === 1 && !e.altKey) { e.preventDefault(); this.input.value += k; this.input.focus(); }
    }
    cancel() {
      if (this.cmd && this.cmd.name === 'pline' && this.cmd.pts.length >= 2) return this.finishCmd();
      if (this.cmd) return this.startCmd(null);
      this.sel.clear();
      this.selChanged();
    }
    startPan(e) {
      const v0 = { ...this.view };
      let moved = false;
      const move = (m) => {
        const dx = m.clientX - e.clientX, dy = m.clientY - e.clientY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        this.panning = true;
        this.view.cx = v0.cx - dx / this.view.s;
        this.view.cy = v0.cy + dy / this.view.s;
        this.redraw();
      };
      const up = (u) => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        this.panning = false;
        if (!moved && e.button === 2) this.rightClick(u);
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    rightClick(e) {
      if (this.cmd) return this.finishCmd();
      const items = [];
      if (this.lastCmd) items.push({ label: `Повторить: ${this.lastCmd}`, icon: 'redo', onClick: () => this.startCmd(this.lastCmd) }, '-');
      if (this.sel.size) items.push(
        { label: 'Переместить', icon: 'move', key: 'M', onClick: () => this.startCmd('move') },
        { label: 'Копировать', icon: 'copy', key: 'CO', onClick: () => this.startCmd('copy') },
        { label: 'Повернуть', icon: 'rotate', key: 'RO', onClick: () => this.startCmd('rotate') },
        { label: 'Зеркало', icon: 'mirror', key: 'MI', onClick: () => this.startCmd('mirror') },
        { label: 'Удалить', icon: 'trash', key: 'Del', onClick: () => this.erase() }, '-');
      if (this.sel.size) {
        const names = this.sel.size > 20000 ? [] : JSON.parse(this.eng.sel_summary(Uint32Array.from([...this.sel]))).layers;
        items.push({ label: 'Приблизить к выделенному', icon: 'fit', onClick: () => this.zoomToSelection() });
        if (names.length === 1) {
          const n = names[0];
          items.push(
            { label: `Выделить весь слой «${n.length > 28 ? n.slice(0, 27) + '…' : n}»`, icon: 'layers', onClick: () => this.selectLayer(n) },
            { label: 'Показать только этот слой', icon: 'eye', onClick: () => { this.layers.forEach((x) => this.eng.set_layer_visible(x.name, x.name === n)); this.refreshLayers(); this.buildSide(); this.redraw(); } },
            { label: 'Скрыть этот слой', icon: 'eyeOff', onClick: () => { this.eng.set_layer_visible(n, false); this.sel.clear(); this.syncSel(); this.refreshLayers(); this.buildSide(); this.redraw(); } },
          );
        }
        items.push('-');
      }
      items.push({ label: 'Карандаш (пометки)', icon: 'pencil', onClick: () => this.startCmd('pencil') }, { label: 'Удалить все пометки', icon: 'inkClear', onClick: () => this.clearInk() }, '-');
      items.push({ label: 'Показать всё', icon: 'fit', key: 'Z', onClick: () => this.zoomExtents() }, { label: 'Выделить всё', icon: 'cursor', key: 'Ctrl+A', onClick: () => { this.sel = new Set(this.eng.select_window(-1e300, -1e300, 1e300, 1e300, true)); this.selChanged(); } });
      UI.menu(e.clientX, e.clientY, items);
    }
    winSelect(e, p0) {
      this.win = { x1: p0.x, y1: p0.y, x2: p0.x, y2: p0.y };
      let moved = false;
      const r = this.over.getBoundingClientRect();
      const move = (m) => { this.win.x2 = m.clientX - r.left; this.win.y2 = m.clientY - r.top; moved = moved || Math.hypot(this.win.x2 - p0.x, this.win.y2 - p0.y) > 3; this.drawOverlay(); };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        const w = this.win;
        this.win = null;
        const keep = e.shiftKey || (this.cmd && this.cmd.name === 'pickfor');
        if (!moved) { if (!keep) this.sel.clear(); this.selChanged(); return; }
        const a = this.s2w(Math.min(w.x1, w.x2), Math.max(w.y1, w.y2)), b = this.s2w(Math.max(w.x1, w.x2), Math.min(w.y1, w.y2));
        const ids = this.eng.select_window(a.x, a.y, b.x, b.y, w.x2 < w.x1);
        if (!keep) this.sel.clear();
        for (const i of ids) this.sel.add(i);
        this.selChanged();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    dragGrip(g) {
      this.cmd = { name: 'grip', pts: [g.p], excl: new Set([g.i]) };
      const orig = this.ent(g.i);
      let last = null;
      const move = () => {
        const n = JSON.parse(JSON.stringify(orig));
        g.apply(n, this.cursorWorld());
        last = n;
        this.gripPreview = n;
        this.worldTransform(this.over.getContext('2d'));
        this.drawOverlay();
        const ctx = this.over.getContext('2d');
        this.worldTransform(ctx);
        this.drawPreview(ctx, n.type === 'insert' || n.type === 'text' ? { type: 'line', p1: orig.p, p2: n.p } : n, this.theme.accent);
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        this.cmd = null;
        this.gripPreview = null;
        if (last && JSON.stringify(last) !== JSON.stringify(orig)) this.replace(g.i, last); else this.renderNow();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    async editText(i) {
      const e = this.ent(i);
      const r = await modal({ title: 'Изменить текст', fields: [{ name: 'text', label: 'Текст', type: 'textarea', value: e.text }, { name: 'h', label: 'Высота', type: 'number', value: e.h }], okText: 'Применить' });
      if (!r) return;
      const n = JSON.parse(JSON.stringify(e));
      n.text = r.text; if (r.h > 0) n.h = r.h; n.mtext = n.mtext || r.text.includes('\n');
      this.replace(i, n);
    }

    // ------------------------------------------------------------ print / PDF
    /** opens the print dialog; `region` = world box picked with «Рамка» */
    async printDialog(region) {
      if (!this.eng) return;
      const o = (this.printOpts = this.printOpts || { what: 'all', paper: 'A3', orient: 'auto', scale: 'fit', custom: 500, color: 'color', lw: '0.18', title: true });
      if (region) o.what = 'window';
      const unit = this.unitName();
      const body = el('div', { class: 'print-form' });
      const row = (label, input) => body.append(el('div', { class: 'field' }, [el('label', { text: label }), input]));
      const sel = (name, options) => { const s = el('select'); options.forEach(([v, t]) => s.append(el('option', { value: v, text: t }))); s.value = o[name]; s.addEventListener('change', () => { o[name] = s.value; upd(); }); return s; };
      const what = sel('what', [['all', 'Весь чертёж (видимые слои)'], ['view', 'Текущий вид на экране'], ['window', region || this.printRegion ? 'Рамка (выбрана)' : 'Рамка — выбрать на чертеже…']]);
      row('Что печатать', what);
      row('Формат листа', sel('paper', [['A4', 'A4 (210 × 297)'], ['A3', 'A3 (297 × 420)'], ['A2', 'A2 (420 × 594)'], ['A1', 'A1 (594 × 841)'], ['A0', 'A0 (841 × 1189)']]));
      row('Ориентация', sel('orient', [['auto', 'Автоматически'], ['land', 'Альбомная'], ['port', 'Книжная']]));
      const scaleSel = sel('scale', [['fit', 'Вписать в лист'], ['100', '1:100'], ['200', '1:200'], ['250', '1:250'], ['500', '1:500'], ['1000', '1:1000'], ['2000', '1:2000'], ['5000', '1:5000'], ['custom', 'Другой…']]);
      const custom = el('input', { type: 'number', min: '1', step: 'any', value: o.custom, style: { width: '90px' } });
      custom.addEventListener('input', () => { o.custom = +custom.value; upd(); });
      row('Масштаб', el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, [scaleSel, el('span', { text: '1:' }), custom]));
      row('Цвета', sel('color', [['color', 'Цветная (на белом)'], ['mono', 'Чёрно-белая']]));
      row('Толщина линий', sel('lw', [['0.1', '0,10 мм'], ['0.18', '0,18 мм'], ['0.25', '0,25 мм'], ['0.35', '0,35 мм'], ['0.5', '0,50 мм']]));
      const info = el('div', { class: 'print-info' });
      body.append(info, el('div', { class: 'print-hint', text: `Единицы чертежа: ${unit} (меняются внизу справа). Масштаб 1:N означает: 1 мм на бумаге = N мм на местности.` }));
      const upd = () => {
        custom.parentElement.querySelectorAll('span, input').forEach((x) => (x.style.display = o.scale === 'custom' ? '' : 'none'));
        const lay = this.printLayout(o, region || this.printRegion);
        info.textContent = lay ? `Лист ${lay.pw} × ${lay.ph} мм, масштаб ${lay.scaleText}${lay.clipped ? ' — чертёж не помещается на лист целиком, будет обрезан' : ''}` : 'Нечего печатать';
        info.classList.toggle('warn', !!(lay && lay.clipped));
      };
      upd();
      // custom buttons: PDF / print / pick window
      let action = null;
      const pdfBtn = el('button', { type: 'button', class: 'primary', text: 'Сохранить PDF' });
      const prnBtn = el('button', { type: 'button', text: 'Печать…' });
      body.append(el('div', { class: 'print-actions' }, [prnBtn, pdfBtn]));
      const done = modal({ title: 'Печать и PDF', body, okText: 'Отмена', cancelText: null });
      const finish = (a) => { action = a; const m = document.querySelector('.modal-back'); if (m) m.remove(); };
      pdfBtn.addEventListener('click', () => finish('pdf'));
      prnBtn.addEventListener('click', () => finish('print'));
      what.addEventListener('change', () => { if (o.what === 'window') finish('pick'); });
      await Promise.race([done, new Promise((r) => { const t = setInterval(() => { if (action) { clearInterval(t); r(); } }, 50); })]);
      if (action === 'pick') {
        toast('Укажите два угла области печати');
        this.startCmd('printwin');
        return;
      }
      if (action === 'pdf' || action === 'print') this.printRun(o, region || this.printRegion, action);
    }
    /** paper size / scale / view for a print job */
    printLayout(o, region) {
      let box;
      if (o.what === 'view') { const v = this.visibleBox(); box = [v.x1, v.y1, v.x2, v.y2]; }
      else if (o.what === 'window' && region) box = region;
      else { const b = this.eng.view_extents(true); if (!b.length) return null; box = b.slice(0, 4); }
      const w = Math.max(box[2] - box[0], 1e-9), h = Math.max(box[3] - box[1], 1e-9);
      const sizes = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };
      let [a, b] = sizes[o.paper] || sizes.A3;
      const land = o.orient === 'land' || (o.orient === 'auto' && w >= h);
      const pw = land ? b : a, ph = land ? a : b;
      const margin = 10;
      const aw = pw - 2 * margin, ah = ph - 2 * margin;
      const unitMm = { 'мм': 1, 'см': 10, 'м': 1000, 'км': 1e6 }[this.unitName()] || 1;
      let mmPerUnit, scaleText;
      if (o.scale === 'fit') {
        mmPerUnit = Math.min(aw / w, ah / h);
        const N = unitMm / mmPerUnit;
        scaleText = `≈ 1:${N >= 10 ? Math.round(N) : +N.toPrecision(3)} (вписано)`;
      } else {
        const N = o.scale === 'custom' ? Math.max(1e-6, +o.custom || 1) : +o.scale;
        mmPerUnit = unitMm / N;
        scaleText = `1:${N}`;
      }
      const clipped = w * mmPerUnit > aw + 0.5 || h * mmPerUnit > ah + 0.5;
      return { pw, ph, mmPerUnit, scaleText, clipped, cx: (box[0] + box[2]) / 2, cy: (box[1] + box[3]) / 2, margin };
    }
    async printRun(o, region, action) {
      const lay = this.printLayout(o, region);
      if (!lay) { toast('Нечего печатать'); return; }
      const busy = toast('Готовлю лист к печати…', null, 60000);
      await new Promise((r) => setTimeout(r, 30));
      try {
        // resolution: as high as the canvas allows for the paper size
        const area = lay.pw * lay.ph;
        const dpi = Math.min(300, Math.floor(Math.sqrt(40e6 / (area / 645.16))));
        const pxmm = dpi / 25.4;
        const Wpx = Math.round(lay.pw * pxmm), Hpx = Math.round(lay.ph * pxmm);
        const geo = document.createElement('canvas');
        geo.width = Wpx; geo.height = Hpx;
        const pv = new Canvas2DView(geo);
        pv.dpr = 1;
        if (this.gl instanceof Canvas2DView) pv.sets = this.gl.sets;
        else this.rebuild(false, pv);
        const th = o.color === 'mono' ? { ...makeTheme('#ffffff'), fg: '#000000', light: true } : makeTheme('#ffffff');
        const mode = o.color === 'mono' ? 3 : 1;
        const view = { cx: lay.cx, cy: lay.cy, s: lay.mmPerUnit * pxmm, W: Wpx, H: Hpx };
        const linePx = Math.max(1, parseFloat(o.lw) * pxmm);
        pv.draw(view, this.origin, this.layerByIndex || [], hexRgb(th.fg), null, mode, { linePx });
        // texts and red pencil marks through the normal code with a temporary view
        const txt = document.createElement('canvas');
        txt.width = Wpx; txt.height = Hpx;
        const saved = { textCanvas: this.textCanvas, view: this.view, W: this.W, H: this.H, dpr: this.dpr };
        Object.assign(this, { textCanvas: txt, view: { cx: lay.cx, cy: lay.cy, s: view.s }, W: Wpx, H: Hpx, dpr: 1 });
        try { this.drawTexts(th); } finally { Object.assign(this, saved); }
        const ctx = geo.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(txt, 0, 0);
        if (this.ink && this.ink.length) {
          ctx.setTransform(view.s, 0, 0, -view.s, Wpx / 2 - lay.cx * view.s, Hpx / 2 + lay.cy * view.s);
          ctx.strokeStyle = INK_RED; ctx.lineWidth = (0.5 * pxmm) / view.s; ctx.lineCap = 'round';
          ctx.beginPath();
          for (let i = 0; i < this.ink.length; i += 4) { ctx.moveTo(this.ink[i], this.ink[i + 1]); ctx.lineTo(this.ink[i + 2], this.ink[i + 3]); }
          ctx.stroke();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
        // white paper behind, clear the margins
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, Wpx, Hpx);
        ctx.globalCompositeOperation = 'source-over';
        const m = lay.margin * pxmm;
        ctx.fillRect(0, 0, Wpx, m); ctx.fillRect(0, Hpx - m, Wpx, m); ctx.fillRect(0, 0, m, Hpx); ctx.fillRect(Wpx - m, 0, m, Hpx);
        // small caption under the drawing
        const name = (window.App.active() && window.App.active().name) || 'Чертёж';
        ctx.fillStyle = '#555'; ctx.font = `${Math.round(2.4 * pxmm)}px Arial`; ctx.textBaseline = 'middle';
        ctx.fillText(`${name} · масштаб ${lay.scaleText.replace(' (вписано)', '')} · ${new Date().toLocaleDateString('ru')}`, m, Hpx - m / 2);
        const blob = await new Promise((r) => geo.toBlob(r, 'image/png'));
        const png = new Uint8Array(await blob.arrayBuffer());
        busy.remove && busy.remove();
        const res = await window.api.printRaster({ png, widthMm: lay.pw, heightMm: lay.ph, action, suggestedName: name });
        if (res && res.ok && action === 'pdf') toast('PDF сохранён: ' + res.path.split(/[\\/]/).pop());
        else if (res && !res.ok && !res.canceled) toast('Не удалось: ' + res.error, 'error', 7000);
      } catch (e) {
        console.error(e);
        toast('Ошибка печати: ' + e.message, 'error', 7000);
      } finally {
        if (busy && busy.remove) busy.remove();
        this.renderNow();
      }
    }

    // ------------------------------------------------------------ editor API
    getData() { return { dxf: this.eng ? this.eng.to_dxf() : new Uint8Array(0) }; }
    exportMenu() {
      const run = async (light) => {
        const c = document.createElement('canvas');
        c.width = this.bgCanvas.width; c.height = this.bgCanvas.height;
        const ctx = c.getContext('2d');
        const th = light ? makeTheme('#ffffff') : this.theme;
        this.renderNow(th); // bg + GPU geometry + texts with this theme, read back in the same task
        ctx.drawImage(this.bgCanvas, 0, 0);
        ctx.drawImage(this.glCanvas, 0, 0);
        ctx.drawImage(this.textCanvas, 0, 0);
        this.renderNow();
        const name = (window.App.active() && window.App.active().name) || 'Чертёж';
        const r = await window.api.exportPng({ dataUrl: c.toDataURL('image/png'), suggestedName: name });
        if (r.ok) toast('PNG сохранён');
      };
      const b = this.pngBtn.getBoundingClientRect();
      UI.menu(b.left, b.bottom + 4, [
        { label: 'PNG на белом фоне (для печати)', icon: 'image', onClick: () => run(true) },
        { label: 'PNG с текущим фоном', icon: 'image', onClick: () => run(false) },
      ]);
    }
    onActivate() { requestAnimationFrame(() => { this.resize(); this.wrap.focus({ preventScroll: true }); }); }
    destroy() { window.removeEventListener('cad-bg-change', this.onBgChange); if (this.ro) this.ro.disconnect(); if (this.eng) { this.eng.free(); this.eng = null; } }
  }

  window.CadEditor = CadEditor;
})();
