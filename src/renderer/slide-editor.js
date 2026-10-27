/* PowerPoint-like slide editor */
(function () {
  const { el, btn, group, select, colorButton, toast, modal, esc, rgbToHex } = UI;
  const DPI = 96;
  const FONTS = ['Calibri', 'Arial', 'Segoe UI', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Courier New', 'Impact'];
  const SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 60, 72, 96];
  const PH = { title: 'Щёлкните дважды, чтобы добавить заголовок', body: 'Щёлкните дважды, чтобы добавить текст', sub: 'Щёлкните дважды, чтобы добавить подзаголовок' };

  let uid = 1;
  const newId = () => 'n' + Date.now().toString(36) + (uid++);
  const clone = (o) => (Array.isArray(o) ? o.map(clone) : o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, clone(v)])) : o);
  const round = (v) => Math.round(v * 1000) / 1000;

  // ------------------------------------------------------------ geometry -> SVG
  function shapeSvg(e) {
    const w = e.w * DPI, h = e.h * DPI;
    const fill = e.fill || 'none';
    const sw = e.line ? (e.line.width || 1) * 96 / 72 : 0;
    const stroke = e.line ? `stroke="${e.line.color}" stroke-width="${sw}"` : '';
    const pts = (arr) => `<polygon points="${arr.map(([x, y]) => `${round(x * w)},${round(y * h)}`).join(' ')}" fill="${fill}" ${stroke} stroke-linejoin="round"/>`;
    let body;
    switch (e.geom) {
      case 'ellipse': case 'cloud': body = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${fill}" ${stroke}/>`; break;
      case 'roundRect': { const r = Math.min(w, h) * 0.1667; body = `<rect width="${w}" height="${h}" rx="${r}" fill="${fill}" ${stroke}/>`; break; }
      case 'triangle': body = pts([[0.5, 0], [1, 1], [0, 1]]); break;
      case 'rtTriangle': body = pts([[0, 0], [0, 1], [1, 1]]); break;
      case 'diamond': body = pts([[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]); break;
      case 'pentagon': body = pts([[0.5, 0], [1, 0.38], [0.81, 1], [0.19, 1], [0, 0.38]]); break;
      case 'hexagon': body = pts([[0.25, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0.25, 1], [0, 0.5]]); break;
      case 'octagon': body = pts([[0.29, 0], [0.71, 0], [1, 0.29], [1, 0.71], [0.71, 1], [0.29, 1], [0, 0.71], [0, 0.29]]); break;
      case 'parallelogram': body = pts([[0.25, 0], [1, 0], [0.75, 1], [0, 1]]); break;
      case 'rightArrow': body = pts([[0, 0.25], [0.6, 0.25], [0.6, 0], [1, 0.5], [0.6, 1], [0.6, 0.75], [0, 0.75]]); break;
      case 'leftArrow': body = pts([[1, 0.25], [0.4, 0.25], [0.4, 0], [0, 0.5], [0.4, 1], [0.4, 0.75], [1, 0.75]]); break;
      case 'upArrow': body = pts([[0.25, 1], [0.25, 0.4], [0, 0.4], [0.5, 0], [1, 0.4], [0.75, 0.4], [0.75, 1]]); break;
      case 'downArrow': body = pts([[0.25, 0], [0.25, 0.6], [0, 0.6], [0.5, 1], [1, 0.6], [0.75, 0.6], [0.75, 0]]); break;
      case 'chevron': body = pts([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1], [0.25, 0.5]]); break;
      case 'homePlate': body = pts([[0, 0], [0.75, 0], [1, 0.5], [0.75, 1], [0, 1]]); break;
      case 'star5': {
        const a = [];
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.19 : 0.5, t = -Math.PI / 2 + (i * Math.PI) / 5; a.push([0.5 + r * Math.cos(t) * 1, 0.52 + r * Math.sin(t) * 1.05]); }
        body = pts(a); break;
      }
      case 'heart': body = `<path d="M${w / 2},${h} C${-w * 0.1},${h * 0.55} ${w * 0.05},${-h * 0.1} ${w / 2},${h * 0.25} C${w * 0.95},${-h * 0.1} ${w * 1.1},${h * 0.55} ${w / 2},${h}Z" fill="${fill}" ${stroke}/>`; break;
      case 'line': {
        const [x1, y1, x2, y2] = e.flipH ? [w, 0, 0, h] : [0, 0, w, h];
        const [a1, b1, a2, b2] = e.flipV ? [x1, h - y1, x2, h - y2] : [x1, y1, x2, y2];
        body = `<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b2}" stroke="${e.line ? e.line.color : '#000'}" stroke-width="${Math.max(sw, 1)}" stroke-linecap="round"/>`;
        break;
      }
      default: body = `<rect width="${w}" height="${h}" fill="${fill}" ${stroke}/>`;
    }
    const flip = e.geom !== 'line' && (e.flipH || e.flipV) ? ` style="transform:scale(${e.flipH ? -1 : 1},${e.flipV ? -1 : 1})"` : '';
    return `<svg class="shape-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${flip}>${body}</svg>`;
  }

  function runStyle(r) {
    const s = [];
    if (r.size) s.push(`font-size:${r.size}pt`);
    if (r.color) s.push(`color:${r.color}`);
    if (r.font) s.push(`font-family:'${String(r.font).replace(/'/g, '')}'`);
    if (r.b) s.push('font-weight:700');
    if (r.i) s.push('font-style:italic');
    const dec = [r.u && 'underline', r.s && 'line-through'].filter(Boolean).join(' ');
    if (dec) s.push(`text-decoration:${dec}`);
    return s.join(';');
  }
  function parasHtml(paras) {
    let num = 0;
    return paras.map((p) => {
      num = p.bullet === 'number' ? num + 1 : 0;
      const runs = p.runs.length ? p.runs : [{ text: '' }];
      const first = runs.find((r) => !r.br) || {};
      let inner = runs.map((r) => (r.br ? '<br>' : `<span style="${runStyle(r)}">${esc(r.text)}</span>`)).join('');
      if (!runs.some((r) => !r.br && r.text)) inner = `<span style="${runStyle(first)}"><br></span>`;
      const st = [`text-align:${p.align || 'left'}`];
      if (p.level) st.push(`margin-left:${p.level * 0.375}in`);
      if (p.bullet) st.push(`font-size:${first.size || 18}pt`);
      return `<div class="p" data-bullet="${p.bullet || false}" data-level="${p.level || 0}" data-num="${num}" style="${st.join(';')}">${inner}</div>`;
    }).join('');
  }
  const hasText = (e) => e.paras && e.paras.some((p) => p.runs.some((r) => r.text && r.text.length));

  function renderElement(e, opts = {}) {
    const d = el('div', { class: 'el', 'data-id': e.id });
    Object.assign(d.style, { left: e.x * DPI + 'px', top: e.y * DPI + 'px', width: e.w * DPI + 'px', height: e.h * DPI + 'px' });
    if (e.rot) d.style.transform = `rotate(${e.rot}deg)`;
    if (e.type === 'ink') {
      // stroke width in viewBox units so it stays constant when the box is resized
      const k = ((e.w * DPI) / (e.vw || e.w) + (e.h * DPI) / (e.vh || e.h)) / 2 || DPI;
      const sw = ((e.width || 3) * 96) / 72 / k;
      d.insertAdjacentHTML('beforeend', `<svg class="ink-svg" viewBox="0 0 ${e.vw || e.w} ${e.vh || e.h}" preserveAspectRatio="none">${e.paths.map((pts) => `<path d="${Ink.pathD(pts)}" stroke="${e.color || Ink.COLOR}" stroke-width="${sw}"/>`).join('')}</svg>`);
    } else if (e.type === 'image') {
      d.append(el('img', { src: e.data, draggable: 'false' }));
    } else if (e.type === 'table') {
      const t = el('table');
      const colsTotal = (e.cols || []).reduce((a, b) => a + b, 0);
      if (e.cols && e.cols.length && colsTotal) {
        const cg = el('colgroup');
        e.cols.forEach((c) => cg.append(el('col', { style: { width: (c / colsTotal) * 100 + '%' } })));
        t.append(cg);
      }
      for (const row of e.rows) {
        const tr = el('tr');
        for (const c of row) {
          const td = el('td', { text: c.text });
          td.style.cssText = `font-size:${c.size || 14}pt;color:${c.color || '#000'};${c.b ? 'font-weight:700;' : ''}${c.fill ? `background:${c.fill};` : ''}white-space:pre-wrap`;
          tr.append(td);
        }
        t.append(tr);
      }
      d.append(t);
    } else {
      if (e.fill || e.line || (e.geom && e.geom !== 'rect')) d.insertAdjacentHTML('beforeend', shapeSvg(e));
      const txt = el('div', { class: 'txt va-' + (e.valign || 'top') });
      if (e.geom === 'ellipse') txt.style.padding = '12% 14%';
      if (hasText(e) || opts.editing) txt.innerHTML = parasHtml(e.paras && e.paras.length ? e.paras : [defaultPara(e)]);
      else if (opts.placeholders && !e.fill && !e.line) {
        d.style.outline = '1px dashed #b4bccb';
        const p = defaultPara(e);
        txt.innerHTML = `<div class="p" style="text-align:${p.align}"><span style="${runStyle({ ...p.runs[0], color: '#9aa3b2' })}">${PH[e.ph] || PH.body}</span></div>`;
      }
      if (e.geom !== 'line') d.append(txt);
    }
    return d;
  }
  function defaultPara(e) {
    const base = e.defaults || {};
    return { runs: [{ text: '', size: base.size || 18, color: base.color || '#000000', font: base.font || 'Calibri', b: !!base.b }], align: base.align || 'left', bullet: base.bullet || false, level: 0 };
  }

  function renderSlide(model, slide, opts = {}) {
    const s = el('div', { class: 'slide' });
    s.style.width = model.width * DPI + 'px';
    s.style.height = model.height * DPI + 'px';
    s.style.background = slide.background || '#ffffff';
    if (slide.backgroundImage) { s.style.backgroundImage = `url("${slide.backgroundImage}")`; s.style.backgroundSize = 'cover'; }
    for (const e of slide.elements) s.append(renderElement(e, opts));
    return s;
  }

  // read an editable .txt DOM back to paragraphs
  function readParas(txt) {
    const blocks = Array.from(txt.childNodes).filter((n) => !(n.nodeType === 3 && !n.nodeValue.trim()));
    const groups = [];
    let loose = null;
    for (const b of blocks) {
      if (b.nodeType === 1 && (b.tagName === 'DIV' || b.tagName === 'P')) { loose = null; groups.push(b); }
      else { if (!loose) { loose = document.createElement('div'); groups.push({ loose: true, nodes: [] }); } groups[groups.length - 1].nodes.push(b); }
    }
    const paras = [];
    for (const g of groups) {
      let block = g;
      if (g.loose) { block = document.createElement('div'); block.className = 'p'; g.nodes.forEach((n) => block.append(n)); txt.append(block); }
      const cs = getComputedStyle(block);
      const runs = [];
      const walk = (n) => {
        for (const c of Array.from(n.childNodes)) {
          if (c.nodeType === 3) {
            if (!c.nodeValue) continue;
            const s = getComputedStyle(c.parentElement);
            const dec = s.textDecorationLine || '';
            const r = {
              text: c.nodeValue.replace(/ /g, ' '),
              size: Math.round((parseFloat(s.fontSize) * 72) / 96 * 2) / 2,
              color: rgbToHex(s.color) || '#000000',
              font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
            };
            if (+s.fontWeight >= 600) r.b = true;
            if (s.fontStyle === 'italic') r.i = true;
            // decorations set on ancestors are not inherited by computed style — walk up
            let u = /underline/.test(dec), st = /line-through/.test(dec);
            for (let a = c.parentElement; a && a !== block; a = a.parentElement) {
              const d = getComputedStyle(a).textDecorationLine;
              if (/underline/.test(d)) u = true;
              if (/line-through/.test(d)) st = true;
            }
            if (u) r.u = true;
            if (st) r.s = true;
            const prev = runs[runs.length - 1];
            if (prev && !prev.br && ['size', 'color', 'font', 'b', 'i', 'u', 's'].every((k) => prev[k] === r[k])) prev.text += r.text;
            else runs.push(r);
          } else if (c.nodeType === 1) {
            if (c.tagName === 'BR') { if (c !== block.lastChild && c.nextSibling) runs.push({ text: '\n', br: true }); }
            else if (c.tagName === 'DIV' || c.tagName === 'P') { walk(c); }
            else walk(c);
          }
        }
      };
      walk(block);
      if (!runs.length) {
        const s = getComputedStyle(block.querySelector('span') || block);
        runs.push({ text: '', size: Math.round((parseFloat(s.fontSize) * 72) / 96 * 2) / 2, color: rgbToHex(s.color) || '#000000', font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim() });
      }
      const bullet = block.dataset && block.dataset.bullet;
      paras.push({
        runs,
        align: ['center', 'right', 'justify'].includes(cs.textAlign) ? cs.textAlign : 'left',
        bullet: bullet === 'true' ? true : bullet === 'number' ? 'number' : false,
        level: +((block.dataset && block.dataset.level) || 0),
      });
    }
    return paras.length ? paras : null;
  }

  function newModel() {
    return {
      width: 13.333, height: 7.5,
      slides: [titleSlide()],
    };
  }
  function titleSlide() {
    return {
      id: newId(), background: '#ffffff', backgroundImage: null, notes: '',
      elements: [
        { id: newId(), type: 'box', geom: 'rect', ph: 'title', x: 1, y: 2.3, w: 11.333, h: 1.5, rot: 0, fill: null, line: null, valign: 'bottom', paras: [], defaults: { size: 44, color: '#1d2330', font: 'Calibri', b: true, align: 'center' } },
        { id: newId(), type: 'box', geom: 'rect', ph: 'sub', x: 1.5, y: 4, w: 10.333, h: 1, rot: 0, fill: null, line: null, valign: 'top', paras: [], defaults: { size: 24, color: '#687284', font: 'Calibri', align: 'center' } },
      ],
    };
  }

  // ======================================================================
  class SlideEditor {
    constructor(root, data, { onDirty }) {
      this.root = root;
      this.onDirty = onDirty;
      this.model = data.model || newModel();
      this.cur = 0;
      this.sel = new Set();
      this.editing = null;
      this.tool = null;
      this.history = [];
      this.future = [];
      this.clip = null;
      this.lastSnap = this.snapshot();
      this.fill = '#4a86e8';
      this.lineColor = '#1c4587';
      this.textColor = '#000000';

      this.thumbs = el('div', { class: 'sl-thumbs' });
      this.stage = el('div', { class: 'sl-stage' });
      this.stageWrap = el('div', { class: 'sl-stage-wrap', tabindex: '0' }, this.stage);
      this.notes = el('textarea', { placeholder: 'Заметки докладчика' });
      this.notes.addEventListener('input', () => { this.slide().notes = this.notes.value; this.dirtySoon(); });
      const center = el('div', { class: 'sl-center' }, [this.stageWrap, el('div', { class: 'sl-notes' }, this.notes)]);
      this.status = el('span');
      root.append(this.buildToolbar(), el('div', { class: 'sl-main' }, [this.thumbs, center]), el('div', { class: 'statusbar' }, [el('span', { text: 'Презентация PowerPoint' }), this.status, el('span', { class: 'spacer' }), el('span', { text: 'F5 — показ  ·  двойной щелчок — редактировать текст' })]));

      this.bind();
      this.ro = new ResizeObserver(() => this.layoutStage());
      this.ro.observe(this.stageWrap);
      this.renderThumbs();
      this.renderStage();
    }

    slide() { return this.model.slides[this.cur]; }
    find(id) { return this.slide().elements.find((e) => e.id === id); }
    selected() { return this.slide().elements.filter((e) => this.sel.has(e.id)); }

    // ------------------------------------------------------------ history
    snapshot() { return { model: clone(this.model), cur: this.cur }; }
    commit() {
      this.history.push(this.lastSnap);
      if (this.history.length > 80) this.history.shift();
      this.future = [];
      this.lastSnap = this.snapshot();
      this.onDirty();
      this.updateThumb(this.cur);
    }
    dirtySoon() { clearTimeout(this.dt); this.dt = setTimeout(() => this.commit(), 400); }
    restore(s) {
      this.model = clone(s.model);
      this.cur = Math.min(s.cur, this.model.slides.length - 1);
      this.sel.clear();
      this.editing = null;
      this.lastSnap = this.snapshot();
      this.renderThumbs();
      this.renderStage();
      this.onDirty();
    }
    undo() {
      if (this.editing) { document.execCommand('undo'); return; }
      if (!this.history.length) return;
      this.future.push(this.snapshot());
      this.restore(this.history.pop());
    }
    redo() {
      if (this.editing) { document.execCommand('redo'); return; }
      if (!this.future.length) return;
      this.history.push(this.snapshot());
      this.restore(this.future.pop());
    }

    // ------------------------------------------------------------ toolbar
    buildToolbar() {
      const shapes = [
        ['rect', 'Прямоугольник', 'rect'], ['roundRect', 'Скруглённый прямоугольник', 'rect'], ['ellipse', 'Эллипс', 'ellipse'], ['triangle', 'Треугольник', 'triangle'],
        ['diamond', 'Ромб', 'diamond'], ['pentagon', 'Пятиугольник', 'shapes'], ['hexagon', 'Шестиугольник', 'shapes'], ['star5', 'Звезда', 'star'],
        ['rightArrow', 'Стрелка вправо', 'arrow'], ['chevron', 'Шеврон', 'arrow'], ['heart', 'Сердце', 'shapes'], ['line', 'Линия', 'line'],
      ];
      this.fontSel = select(FONTS, { title: 'Шрифт', width: 112, onChange: (v) => this.applyRun({ font: v }, () => this.execText('fontName', v)) });
      this.sizeSel = select(SIZES.map(String), { title: 'Размер', width: 58, onChange: (v) => this.applyRun({ size: +v }, () => this.execFontSize(+v)) });
      this.sizeSel.value = '18';
      for (const s of [this.fontSel, this.sizeSel]) s.addEventListener('mousedown', () => this.saveRange());
      const tb = (ic, title, fn, label) => btn({ icon: ic, title, label, onClick: fn });
      this.btnB = tb('bold', 'Полужирный (Ctrl+B)', () => this.toggleRun('b', 'bold'));
      this.btnI = tb('italic', 'Курсив (Ctrl+I)', () => this.toggleRun('i', 'italic'));
      this.btnU = tb('underline', 'Подчёркнутый (Ctrl+U)', () => this.toggleRun('u', 'underline'));
      const txtColor = colorButton({ icon: 'textColor', title: 'Цвет текста', get: () => this.textColor, onPick: (c) => { this.textColor = c; this.applyRun({ color: c }, () => this.execText('foreColor', c)); } });
      const fillBtn = colorButton({ icon: 'paint', title: 'Заливка фигуры', fill: true, allowNone: true, noneLabel: 'Без заливки', get: () => this.fill, onPick: (c) => { if (c) this.fill = c; this.applyEl((e) => { if (e.type === 'box' && e.geom !== 'line') e.fill = c; }); } });
      const lineBtn = colorButton({ icon: 'border', title: 'Контур', fill: true, allowNone: true, noneLabel: 'Без контура', get: () => this.lineColor, onPick: (c) => { if (c) this.lineColor = c; this.applyEl((e) => { if (e.type === 'box') e.line = c ? { color: c, width: (e.line && e.line.width) || 1.5 } : null; }); } });
      const lineW = btn({ icon: 'hr', title: 'Толщина контура', onClick: (ev, b) => UI.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, [0.75, 1, 1.5, 2.25, 3, 4.5, 6].map((w) => ({ label: `${w} пт`, onClick: () => this.applyEl((e) => { if (e.type === 'box') e.line = { color: (e.line && e.line.color) || this.lineColor, width: w }; }) }))) });
      this.toolBtns = {
        text: btn({ icon: 'text', title: 'Вставить надпись — щёлкните или растяните на слайде', onClick: () => this.setTool(this.tool === 'text' ? null : 'text') }),
      };
      this.toolBtns.pencil = btn({ icon: 'pencil', label: 'Карандаш', cls: 'pencil', title: 'Красный карандаш: рисуйте пометки поверх слайда (Esc — выход)', onClick: () => this.setTool(this.tool === 'pencil' ? null : 'pencil') });
      this.toolBtns.eraser = btn({ icon: 'eraser', title: 'Ластик: проведите по пометкам, чтобы стереть', onClick: () => this.setTool(this.tool === 'eraser' ? null : 'eraser') });
      const inkClear = btn({ icon: 'inkClear', title: 'Удалить все пометки на этом слайде', onClick: () => this.clearInk() });
      const shapeBtn = btn({ icon: 'shapes', title: 'Вставить фигуру', onClick: (e, b) => UI.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, shapes.map(([g, label, ic]) => ({ label, icon: ic, onClick: () => this.setTool('shape:' + g) }))) });
      this.toolBtns.shape = shapeBtn;
      const addSlide = btn({ icon: 'plus', label: 'Слайд', title: 'Новый слайд', onClick: (e, b) => UI.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, [
        { label: 'Заголовок и объект', icon: 'slideLayout', onClick: () => this.addSlide('content') },
        { label: 'Титульный слайд', icon: 'text', onClick: () => this.addSlide('title') },
        { label: 'Только заголовок', icon: 'alignCenter', onClick: () => this.addSlide('titleOnly') },
        { label: 'Пустой слайд', icon: 'rect', onClick: () => this.addSlide('blank') },
        '-',
        { label: 'Дублировать текущий', icon: 'dup', onClick: () => this.dupSlide(this.cur) },
      ]) });
      const bgBtn = btn({ icon: 'paint', title: 'Фон слайда', onClick: (e, b) => UI.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, [
        { label: 'Цвет фона…', icon: 'paint', onClick: () => UI.colorPicker(b, { current: this.slide().background, onPick: (c) => { this.slide().background = c; this.slide().backgroundImage = null; this.renderStage(); this.commit(); } }) },
        { label: 'Фоновый рисунок…', icon: 'image', onClick: async () => { const d = await window.api.pickImage(); if (d) { this.slide().backgroundImage = d; this.renderStage(); this.commit(); } } },
        { label: 'Убрать рисунок', icon: 'x', disabled: !this.slide().backgroundImage, onClick: () => { this.slide().backgroundImage = null; this.renderStage(); this.commit(); } },
        '-',
        { label: 'Применить ко всем слайдам', icon: 'copy', onClick: () => { const s = this.slide(); this.model.slides.forEach((x) => { x.background = s.background; x.backgroundImage = s.backgroundImage; }); this.renderThumbs(); this.renderStage(); this.commit(); } },
      ]) });
      const sizeBtn = btn({ icon: 'slideLayout', title: 'Размер слайдов', onClick: (e, b) => UI.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, [
        { label: 'Широкоэкранный 16:9', onClick: () => this.resizeSlides(13.333, 7.5) },
        { label: 'Стандартный 4:3', onClick: () => this.resizeSlides(10, 7.5) },
        { label: 'Экран 16:10', onClick: () => this.resizeSlides(12, 7.5) },
        { label: 'A4 альбомный', onClick: () => this.resizeSlides(11.69, 8.27) },
      ]) });
      const alignMenu = (e, b) => UI.menu(b.getBoundingClientRect().left, b.getBoundingClientRect().bottom + 4, [
        { label: 'Текст сверху', icon: 'vTop', onClick: () => this.applyEl((x) => { x.valign = 'top'; }) },
        { label: 'Текст по центру', icon: 'vMid', onClick: () => this.applyEl((x) => { x.valign = 'middle'; }) },
        { label: 'Текст снизу', icon: 'vBot', onClick: () => this.applyEl((x) => { x.valign = 'bottom'; }) },
        '-',
        { label: 'Выровнять по центру слайда', icon: 'alignCenter', onClick: () => this.applyEl((x) => { x.x = (this.model.width - x.w) / 2; }) },
        { label: 'Выровнять по середине слайда', icon: 'vMid', onClick: () => this.applyEl((x) => { x.y = (this.model.height - x.h) / 2; }) },
        '-',
        { label: 'Отразить по горизонтали', icon: 'mirror', onClick: () => this.applyEl((x) => { x.flipH = !x.flipH; }) },
        { label: 'Повернуть на 90°', icon: 'rotate', onClick: () => this.applyEl((x) => { x.rot = ((x.rot || 0) + 90) % 360; }) },
      ]);

      return el('div', { class: 'toolbar', style: { '--accent': 'var(--slides)' } }, [
        group(tb('undo', 'Отменить (Ctrl+Z)', () => this.undo()), tb('redo', 'Повторить (Ctrl+Y)', () => this.redo())),
        group(addSlide),
        group(this.toolBtns.text, shapeBtn, tb('image', 'Вставить рисунок', () => this.insertImage()), tb('table', 'Таблица', () => this.insertTable())),
        group(this.toolBtns.pencil, this.toolBtns.eraser, inkClear),
        group(this.fontSel, this.sizeSel, this.btnB, this.btnI, this.btnU, txtColor),
        group(tb('alignLeft', 'По левому краю', () => this.setAlign('left')), tb('alignCenter', 'По центру', () => this.setAlign('center')), tb('alignRight', 'По правому краю', () => this.setAlign('right')),
          tb('listUl', 'Маркеры', () => this.setBullet(true)), tb('listOl', 'Нумерация', () => this.setBullet('number')), btn({ icon: 'vMid', title: 'Выравнивание и поворот', onClick: alignMenu })),
        group(fillBtn, lineBtn, lineW),
        group(tb('front', 'На передний план', () => this.order(1)), tb('back', 'На задний план', () => this.order(-1)), tb('dup', 'Дублировать (Ctrl+D)', () => this.duplicate()), tb('trash', 'Удалить (Del)', () => this.deleteSel())),
        group(bgBtn, sizeBtn),
        group(btn({ icon: 'play', label: 'Показ', title: 'Начать показ (F5)', onClick: () => this.present(0) }), btn({ icon: 'pdf', label: 'PDF', title: 'Сохранить слайды в PDF (Ctrl+E)', onClick: () => this.exportMenu() }), btn({ icon: 'printer', label: 'Печать', title: 'Предпросмотр и печать (Ctrl+P)', onClick: () => this.printPreview() })),
      ]);
    }

    togglePencil() { this.setTool(this.tool === 'pencil' ? null : 'pencil'); }
    setTool(t) {
      this.commitEdit();
      this.tool = t;
      this.toolBtns.text.classList.toggle('on', t === 'text');
      this.toolBtns.shape.classList.toggle('on', !!t && t.startsWith('shape:'));
      this.toolBtns.pencil.classList.toggle('ink-on', t === 'pencil');
      this.toolBtns.eraser.classList.toggle('ink-on', t === 'eraser');
      this.stageWrap.style.cursor = t === 'eraser' ? 'cell' : t ? 'crosshair' : '';
      this.status.textContent = t === 'pencil' ? 'Карандаш: рисуйте мышью поверх слайда · Esc — выход' : t === 'eraser' ? 'Ластик: проведите по пометкам · Esc — выход' : t ? 'Щёлкните или растяните рамку на слайде · Esc — отмена' : '';
    }

    // ------------------------------------------------------------ formatting
    saveRange() {
      const s = getSelection();
      if (this.editing && s.rangeCount) this.savedRange = s.getRangeAt(0).cloneRange();
    }
    restoreRange() {
      if (!this.editing) return;
      const txt = this.editTxt();
      txt.focus();
      if (this.savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(this.savedRange); }
    }
    editTxt() { return this.stage.querySelector(`.el[data-id="${this.editing}"] .txt, .el[data-id="${this.editing}"] table`); }
    execText(cmd, val) {
      this.restoreRange();
      document.execCommand('styleWithCSS', false, true);
      document.execCommand(cmd, false, val);
      document.execCommand('styleWithCSS', false, false);
    }
    execFontSize(pt) {
      this.restoreRange();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      const made = [];
      this.editTxt().querySelectorAll('font[size="7"]').forEach((f) => {
        const s = document.createElement('span');
        s.style.fontSize = pt + 'pt';
        while (f.firstChild) s.append(f.firstChild);
        s.querySelectorAll('span').forEach((x) => (x.style.fontSize = ''));
        f.replaceWith(s);
        made.push(s);
      });
      if (made.length) {
        const r = document.createRange();
        r.setStartBefore(made[0]); r.setEndAfter(made[made.length - 1]);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        this.savedRange = r.cloneRange();
      }
    }
    // apply run props: inside text editing -> to selection; otherwise to all text of selected boxes
    applyRun(props, whenEditing) {
      if (this.editing) { whenEditing(); return; }
      const els = this.selected().filter((e) => e.type === 'box' || e.type === 'table');
      if (!els.length) return;
      for (const e of els) {
        if (e.type === 'table') { e.rows.forEach((r) => r.forEach((c) => { if (props.size) c.size = props.size; if (props.color) c.color = props.color; if ('b' in props) c.b = props.b; })); continue; }
        if (!e.paras || !e.paras.length) { e.defaults = { ...(e.defaults || {}), ...props }; continue; }
        e.paras.forEach((p) => p.runs.forEach((r) => { if (!r.br) Object.assign(r, props); }));
      }
      this.renderStage();
      this.commit();
    }
    toggleRun(key, cmd) {
      if (this.editing) { this.restoreRange(); document.execCommand(cmd); return; }
      const els = this.selected().filter((e) => e.type === 'box');
      const allOn = els.length && els.every((e) => e.paras.length && e.paras.every((p) => p.runs.every((r) => r.br || r[key])));
      this.applyRun({ [key]: !allOn }, () => {});
    }
    setAlign(a) {
      if (this.editing) {
        this.restoreRange();
        document.execCommand({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight' }[a]);
        return;
      }
      this.applyEl((e) => { if (e.paras) e.paras.forEach((p) => (p.align = a)); if (e.defaults) e.defaults.align = a; });
    }
    setBullet(kind) {
      if (this.editing) {
        const txt = this.editTxt();
        const s = getSelection();
        const blocks = Array.from(txt.querySelectorAll('.p, div')).filter((b) => s.rangeCount && s.getRangeAt(0).intersectsNode(b));
        const on = blocks.length && blocks.every((b) => b.dataset.bullet === String(kind));
        blocks.forEach((b) => (b.dataset.bullet = on ? 'false' : String(kind)));
        let n = 0;
        txt.querySelectorAll('.p').forEach((b) => { n = b.dataset.bullet === 'number' ? n + 1 : 0; b.dataset.num = n; });
        return;
      }
      this.applyEl((e) => {
        if (!e.paras) return;
        const on = e.paras.every((p) => p.bullet === kind);
        e.paras.forEach((p) => (p.bullet = on ? false : kind));
        e.defaults = { ...(e.defaults || {}), bullet: on ? false : kind };
      });
    }
    applyEl(fn) {
      const els = this.selected();
      if (!els.length) { toast('Сначала выделите объект на слайде'); return; }
      this.commitEdit();
      els.forEach(fn);
      this.renderStage();
      this.commit();
    }
    order(dir) {
      const els = this.slide().elements;
      const sel = els.filter((e) => this.sel.has(e.id));
      if (!sel.length) return;
      const rest = els.filter((e) => !this.sel.has(e.id));
      this.slide().elements = dir > 0 ? [...rest, ...sel] : [...sel, ...rest];
      this.renderStage();
      this.commit();
    }

    // ------------------------------------------------------------ insert
    insertBox(geom, x, y, w, h, extra = {}) {
      const isText = geom === 'text';
      const e = { ...extra,
        id: newId(), type: 'box', geom: isText ? 'rect' : geom, x, y, w, h, rot: 0,
        fill: isText || geom === 'line' ? null : this.fill,
        line: isText ? null : geom === 'line' ? { color: this.lineColor, width: 2 } : { color: this.lineColor, width: 1 },
        valign: isText ? 'top' : 'middle',
        paras: [], defaults: isText ? { size: 20, color: '#000000', font: 'Calibri' } : { size: 18, color: '#ffffff', font: 'Calibri', align: 'center' },
      };
      if (isText) e.ph = 'body';
      this.slide().elements.push(e);
      this.sel = new Set([e.id]);
      this.renderStage();
      this.commit();
      if (isText) this.startEdit(e.id);
    }
    async insertImage(dataUrl) {
      const src = dataUrl || (await window.api.pickImage());
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const W = this.model.width, H = this.model.height;
        let w = img.naturalWidth / DPI, h = img.naturalHeight / DPI;
        const k = Math.min(1, (W * 0.7) / w, (H * 0.7) / h);
        w *= k; h *= k;
        const e = { id: newId(), type: 'image', data: src, x: (W - w) / 2, y: (H - h) / 2, w, h, rot: 0 };
        this.slide().elements.push(e);
        this.sel = new Set([e.id]);
        this.renderStage();
        this.commit();
      };
      img.src = src;
    }
    async insertTable() {
      const r = await modal({ title: 'Вставить таблицу', fields: [{ name: 'rows', label: 'Строк', type: 'number', value: 3, min: 1, max: 30 }, { name: 'cols', label: 'Столбцов', type: 'number', value: 3, min: 1, max: 15 }], okText: 'Вставить' });
      if (!r || !(r.rows > 0) || !(r.cols > 0)) return;
      const W = this.model.width;
      const w = Math.min(W - 1, r.cols * 2.2), h = r.rows * 0.45;
      const rows = [];
      for (let i = 0; i < r.rows; i++) {
        const row = [];
        for (let j = 0; j < r.cols; j++) row.push(i === 0 ? { text: `Столбец ${j + 1}`, fill: '#e2702f', b: true, size: 14, color: '#ffffff' } : { text: '', fill: i % 2 ? '#fdf1ea' : null, size: 14, color: '#1d2330' });
        rows.push(row);
      }
      const e = { id: newId(), type: 'table', x: (W - w) / 2, y: 1.6, w, h, rot: 0, cols: Array(r.cols).fill(w / r.cols), rows };
      this.slide().elements.push(e);
      this.sel = new Set([e.id]);
      this.renderStage();
      this.commit();
    }
    tableOp(e, op, ri, ci) {
      const ncol = e.rows[0].length;
      const blank = () => ({ text: '', fill: null, size: 14, color: '#1d2330' });
      if (op === 'addRow') { e.rows.splice(ri + 1, 0, Array.from({ length: ncol }, blank)); e.h += 0.45; }
      if (op === 'addCol') { e.rows.forEach((r) => r.splice(ci + 1, 0, { ...blank(), fill: r[ci].fill, b: r[ci].b, color: r[ci].color })); e.cols.splice(ci + 1, 0, e.cols[ci] || 1); }
      if (op === 'delRow' && e.rows.length > 1) { e.rows.splice(ri, 1); e.h = Math.max(0.3, e.h - 0.45); }
      if (op === 'delCol' && ncol > 1) { e.rows.forEach((r) => r.splice(ci, 1)); e.cols.splice(ci, 1); }
      const total = e.cols.reduce((a, b) => a + b, 0);
      e.cols = e.cols.map((c) => (c / total) * e.w);
      this.renderStage();
      this.commit();
    }

    // ------------------------------------------------------------ slides
    addSlide(layout) {
      this.commitEdit();
      const W = this.model.width, H = this.model.height;
      const s = { id: newId(), background: this.slide().background, backgroundImage: this.slide().backgroundImage, notes: '', elements: [] };
      const title = (y, h) => ({ id: newId(), type: 'box', geom: 'rect', ph: 'title', x: 0.6, y, w: W - 1.2, h, rot: 0, fill: null, line: null, valign: 'middle', paras: [], defaults: { size: 36, color: '#1d2330', font: 'Calibri', b: true } });
      if (layout === 'title') { const t = titleSlide(); t.elements.forEach((e) => { e.w = W - 2 * e.x; }); s.elements = t.elements; }
      if (layout === 'content' || layout === 'titleOnly') s.elements.push(title(0.4, 1.1));
      if (layout === 'content') s.elements.push({ id: newId(), type: 'box', geom: 'rect', ph: 'body', x: 0.6, y: 1.7, w: W - 1.2, h: H - 2.3, rot: 0, fill: null, line: null, valign: 'top', paras: [], defaults: { size: 24, color: '#1d2330', font: 'Calibri', bullet: true } });
      this.model.slides.splice(this.cur + 1, 0, s);
      this.cur++;
      this.sel.clear();
      this.renderThumbs();
      this.renderStage();
      this.commit();
    }
    dupSlide(i) {
      const c = clone(this.model.slides[i]);
      c.id = newId();
      c.elements.forEach((e) => (e.id = newId()));
      this.model.slides.splice(i + 1, 0, c);
      this.go(i + 1, true);
      this.commit();
    }
    deleteSlide(i) {
      if (this.model.slides.length === 1) { toast('Нельзя удалить единственный слайд'); return; }
      this.model.slides.splice(i, 1);
      this.cur = Math.min(this.cur, this.model.slides.length - 1);
      this.sel.clear();
      this.renderThumbs();
      this.renderStage();
      this.commit();
    }
    moveSlide(from, to) {
      if (to < 0 || to >= this.model.slides.length || from === to) return;
      const [s] = this.model.slides.splice(from, 1);
      this.model.slides.splice(to, 0, s);
      this.cur = to;
      this.renderThumbs();
      this.renderStage();
      this.commit();
    }
    resizeSlides(w, h) {
      const kx = w / this.model.width, ky = h / this.model.height;
      for (const s of this.model.slides) for (const e of s.elements) {
        e.x *= kx; e.w *= kx; e.y *= ky; e.h *= ky;
        if (e.cols) e.cols = e.cols.map((c) => c * kx);
      }
      this.model.width = w;
      this.model.height = h;
      this.renderThumbs();
      this.renderStage();
      this.commit();
    }
    go(i, rebuild) {
      this.commitEdit();
      this.cur = Math.max(0, Math.min(this.model.slides.length - 1, i));
      this.sel.clear();
      if (rebuild) this.renderThumbs(); else this.thumbs.querySelectorAll('.sl-thumb').forEach((t, k) => t.classList.toggle('active', k === this.cur));
      const t = this.thumbs.children[this.cur];
      if (t) t.scrollIntoView({ block: 'nearest' });
      this.renderStage();
    }

    // ------------------------------------------------------------ rendering
    renderThumbs() {
      this.thumbs.innerHTML = '';
      this.model.slides.forEach((s, i) => {
        const frame = el('div', { class: 'frame' });
        const t = el('div', { class: 'sl-thumb' + (i === this.cur ? ' active' : ''), draggable: 'true' }, [el('div', { class: 'num', text: i + 1 }), frame]);
        t.addEventListener('click', () => this.go(i));
        t.addEventListener('contextmenu', (e) => { e.preventDefault(); this.go(i); UI.menu(e.clientX, e.clientY, [
          { label: 'Новый слайд', icon: 'plus', onClick: () => this.addSlide('content') },
          { label: 'Дублировать слайд', icon: 'dup', onClick: () => this.dupSlide(i) },
          { label: 'Переместить вверх', icon: 'up', disabled: i === 0, onClick: () => this.moveSlide(i, i - 1) },
          { label: 'Переместить вниз', icon: 'down', disabled: i === this.model.slides.length - 1, onClick: () => this.moveSlide(i, i + 1) },
          '-',
          { label: 'Показ с этого слайда', icon: 'play', onClick: () => this.present(i) },
          { label: 'Удалить слайд', icon: 'trash', onClick: () => this.deleteSlide(i) },
        ]); });
        t.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/slide', String(i)); });
        t.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/slide')) { e.preventDefault(); t.classList.add('drop-before'); } });
        t.addEventListener('dragleave', () => t.classList.remove('drop-before'));
        t.addEventListener('drop', (e) => { t.classList.remove('drop-before'); const from = +e.dataTransfer.getData('text/slide'); if (!isNaN(from)) { e.preventDefault(); e.stopPropagation(); this.moveSlide(from, from < i ? i - 1 : i); } });
        this.thumbs.append(t);
      });
      requestAnimationFrame(() => this.model.slides.forEach((_, i) => this.updateThumb(i)));
    }
    updateThumb(i) {
      const t = this.thumbs.children[i];
      if (!t) return;
      const frame = t.querySelector('.frame');
      const fw = frame.clientWidth || 160;
      const k = fw / (this.model.width * DPI);
      frame.style.height = this.model.height * DPI * k + 'px';
      frame.innerHTML = '';
      const s = renderSlide(this.model, this.model.slides[i]);
      s.style.transform = `scale(${k})`;
      frame.append(s);
    }
    layoutStage() {
      const W = this.model.width * DPI, H = this.model.height * DPI;
      const aw = this.stageWrap.clientWidth - 48, ah = this.stageWrap.clientHeight - 48;
      if (aw <= 0 || ah <= 0) return;
      this.scale = Math.min(aw / W, ah / H);
      this.stage.style.width = W * this.scale + 'px';
      this.stage.style.height = H * this.scale + 'px';
      if (this.slideEl) this.slideEl.style.transform = `scale(${this.scale})`;
      this.drawSelection();
    }
    renderStage() {
      const editing = this.editing;
      this.stage.innerHTML = '';
      this.slideEl = renderSlide(this.model, this.slide(), { placeholders: true });
      this.stage.append(this.slideEl);
      this.layoutStage();
      this.notes.value = this.slide().notes || '';
      if (!this.slide().elements.length) this.stage.append(el('div', { class: 'sl-empty-hint', text: 'Пустой слайд — добавьте надпись, фигуру или рисунок' }));
      this.status.textContent = `Слайд ${this.cur + 1} из ${this.model.slides.length}`;
      this.editing = null;
      if (editing && this.find(editing)) this.startEdit(editing);
      this.syncToolbar();
    }
    elDom(id) { return this.slideEl.querySelector(`.el[data-id="${id}"]`); }
    drawSelection() {
      this.stage.querySelectorAll('.sel-box').forEach((n) => n.remove());
      const k = this.scale * DPI;
      for (const e of this.selected()) {
        const box = el('div', { class: 'sel-box' });
        Object.assign(box.style, { left: e.x * k + 'px', top: e.y * k + 'px', width: e.w * k + 'px', height: e.h * k + 'px', transform: e.rot ? `rotate(${e.rot}deg)` : '' });
        if (this.sel.size === 1 && this.editing !== e.id) {
          const H = [['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0], ['e', 1, 0.5], ['se', 1, 1], ['s', 0.5, 1], ['sw', 0, 1], ['w', 0, 0.5]];
          const cursors = { nw: 'nwse', se: 'nwse', ne: 'nesw', sw: 'nesw', n: 'ns', s: 'ns', e: 'ew', w: 'ew' };
          for (const [name, fx, fy] of H) {
            const h = el('div', { class: 'h', 'data-h': name });
            Object.assign(h.style, { left: fx * 100 + '%', top: fy * 100 + '%', cursor: cursors[name] + '-resize' });
            box.append(h);
          }
          box.append(el('div', { class: 'rot-line' }));
          const r = el('div', { class: 'h rot', 'data-h': 'rot', title: 'Повернуть (Shift — шаг 15°)' });
          Object.assign(r.style, { left: '50%', top: '-22px' });
          box.append(r);
        }
        if (this.editing === e.id) box.style.borderStyle = 'dashed';
        this.stage.append(box);
      }
      this.syncToolbar();
    }
    syncToolbar() {
      const e = this.selected().find((x) => x.type === 'box' && x.paras);
      const run = e && ((e.paras[0] && e.paras[0].runs.find((r) => !r.br)) || e.defaults);
      if (run && !this.editing) {
        if (run.size && document.activeElement !== this.sizeSel) { if (![...this.sizeSel.options].some((o) => +o.value === run.size)) this.sizeSel.append(el('option', { value: String(run.size), text: String(run.size) })); this.sizeSel.value = String(run.size); }
        if (run.font && document.activeElement !== this.fontSel) { if (![...this.fontSel.options].some((o) => o.value === run.font)) this.fontSel.append(el('option', { value: run.font, text: run.font })); this.fontSel.value = run.font; }
        this.btnB.classList.toggle('on', !!run.b);
        this.btnI.classList.toggle('on', !!run.i);
        this.btnU.classList.toggle('on', !!run.u);
      }
    }

    // ------------------------------------------------------------ text editing
    startEdit(id) {
      const e = this.find(id);
      if (!e || (e.type !== 'box' && e.type !== 'table') || e.geom === 'line') return;
      this.editing = id;
      this.sel = new Set([id]);
      const old = this.elDom(id);
      const fresh = renderElement(e, { editing: true });
      old.replaceWith(fresh);
      fresh.classList.add('editing');
      const target = e.type === 'table' ? fresh.querySelector('table') : fresh.querySelector('.txt');
      if (e.type === 'table') fresh.querySelectorAll('td').forEach((td) => td.setAttribute('contenteditable', 'true'));
      else target.setAttribute('contenteditable', 'true');
      target.addEventListener('input', () => { this.onDirty(); });
      target.addEventListener('paste', (ev) => { ev.preventDefault(); document.execCommand('insertText', false, ev.clipboardData.getData('text/plain')); });
      const focusEl = e.type === 'table' ? fresh.querySelector('td') : target;
      focusEl.focus();
      if (this.pendingCaret) {
        const r = document.caretRangeFromPoint(this.pendingCaret.x, this.pendingCaret.y);
        if (r && fresh.contains(r.startContainer)) { const s = getSelection(); s.removeAllRanges(); s.addRange(r); if (r.startContainer.parentElement.closest('td')) r.startContainer.parentElement.closest('td').focus(); }
        this.pendingCaret = null;
      } else if (!hasText(e) && e.type === 'box') {
        const r = document.createRange();
        r.selectNodeContents(target.querySelector('span') || target);
        r.collapse(false);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      this.drawSelection();
    }
    commitEdit() {
      if (!this.editing) return;
      const id = this.editing;
      const e = this.find(id);
      const dom = this.elDom(id);
      this.editing = null;
      if (!e || !dom) return;
      if (e.type === 'table') {
        const trs = dom.querySelectorAll('tr');
        trs.forEach((tr, i) => tr.querySelectorAll('td').forEach((td, j) => { if (e.rows[i] && e.rows[i][j]) e.rows[i][j].text = td.innerText.replace(/\n$/, ''); }));
      } else {
        const paras = readParas(dom.querySelector('.txt'));
        const empty = !paras || !paras.some((p) => p.runs.some((r) => r.text));
        if (empty && !e.fill && !e.line && !e.ph) {
          this.slide().elements = this.slide().elements.filter((x) => x.id !== id);
          this.sel.delete(id);
        } else {
          e.paras = empty ? [] : paras;
          if (empty && paras && paras[0]) e.defaults = { ...(e.defaults || {}), ...paras[0].runs[0], align: paras[0].align, bullet: paras[0].bullet };
        }
      }
      getSelection().removeAllRanges();
      this.renderStage();
      this.commit();
    }

    // ------------------------------------------------------------ mouse
    toSlide(ev) {
      const r = this.stage.getBoundingClientRect();
      return { x: (ev.clientX - r.left) / (this.scale * DPI), y: (ev.clientY - r.top) / (this.scale * DPI) };
    }
    bind() {
      const wrap = this.stageWrap;
      wrap.addEventListener('mousedown', (ev) => this.onDown(ev));
      wrap.addEventListener('dblclick', (ev) => {
        const d = ev.target.closest('.el');
        if (d && !d.classList.contains('editing')) { this.pendingCaret = { x: ev.clientX, y: ev.clientY }; this.startEdit(d.dataset.id); }
      });
      wrap.addEventListener('contextmenu', (ev) => this.onContext(ev));
      wrap.addEventListener('keydown', (ev) => this.onKey(ev));
      wrap.addEventListener('paste', (ev) => {
        if (this.editing) return;
        const item = Array.from(ev.clipboardData.items || []).find((i) => i.type.startsWith('image/'));
        if (item) { ev.preventDefault(); const fr = new FileReader(); fr.onload = () => this.insertImage(fr.result); fr.readAsDataURL(item.getAsFile()); return; }
        const text = ev.clipboardData.getData('text/plain');
        if (text && !this.clip) {
          ev.preventDefault();
          const e = { id: newId(), type: 'box', geom: 'rect', x: 1, y: 1, w: this.model.width - 2, h: 1.5, rot: 0, fill: null, line: null, valign: 'top', paras: text.split(/\r?\n/).map((t) => ({ runs: [{ text: t, size: 20, color: '#000000', font: 'Calibri' }], align: 'left', bullet: false, level: 0 })) };
          this.slide().elements.push(e); this.sel = new Set([e.id]); this.renderStage(); this.commit();
        }
      });
      wrap.addEventListener('dragover', (e) => { if (Array.from(e.dataTransfer.items || []).some((i) => i.type.startsWith('image/'))) e.preventDefault(); });
      wrap.addEventListener('drop', (e) => {
        const f = Array.from(e.dataTransfer.files || []).find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        const fr = new FileReader(); fr.onload = () => this.insertImage(fr.result); fr.readAsDataURL(f);
      });
      this.thumbs.addEventListener('keydown', (ev) => this.onKey(ev));
      this.thumbs.tabIndex = 0;
    }

    onDown(ev) {
      if (ev.button !== 0) return;
      const pt = this.toSlide(ev);
      const handle = ev.target.closest('.h');
      const elDom = ev.target.closest('.el');
      if (this.editing) {
        if (elDom && elDom.dataset.id === this.editing) return; // caret placement inside text
        this.commitEdit();
      }
      this.stageWrap.focus({ preventScroll: true });
      if (this.tool === 'pencil') return this.drawInk(ev);
      if (this.tool === 'eraser') return this.eraseInk(ev);
      if (this.tool) return this.drawNew(ev, pt);
      if (handle) return handle.dataset.h === 'rot' ? this.dragRotate(ev) : this.dragResize(ev, handle.dataset.h);
      if (elDom) {
        const id = elDom.dataset.id;
        if (ev.shiftKey || ev.ctrlKey) { this.sel.has(id) ? this.sel.delete(id) : this.sel.add(id); this.drawSelection(); return; }
        if (!this.sel.has(id)) this.sel = new Set([id]);
        this.drawSelection();
        return this.dragMove(ev, pt);
      }
      if (!ev.shiftKey) this.sel.clear();
      this.drawSelection();
      this.marquee(ev, pt);
    }

    drawNew(ev, p0) {
      const kind = this.tool === 'text' ? 'text' : this.tool.slice(6);
      const box = el('div', { class: 'marquee' });
      this.stage.append(box);
      const k = this.scale * DPI;
      let p1 = p0;
      const move = (e) => {
        p1 = this.toSlide(e);
        if (e.shiftKey && kind !== 'text') { const d = Math.max(Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y)); p1 = { x: p0.x + Math.sign(p1.x - p0.x || 1) * d, y: p0.y + Math.sign(p1.y - p0.y || 1) * d }; }
        Object.assign(box.style, { left: Math.min(p0.x, p1.x) * k + 'px', top: Math.min(p0.y, p1.y) * k + 'px', width: Math.abs(p1.x - p0.x) * k + 'px', height: Math.abs(p1.y - p0.y) * k + 'px' });
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        box.remove();
        let x = Math.min(p0.x, p1.x), y = Math.min(p0.y, p1.y), w = Math.abs(p1.x - p0.x), h = Math.abs(p1.y - p0.y);
        if (w < 0.1 && h < 0.1) { w = kind === 'text' ? 4 : kind === 'line' ? 2.5 : 2; h = kind === 'text' ? 0.6 : kind === 'line' ? 0.01 : 1.5; x = p0.x; y = p0.y; }
        const extra = {};
        if (kind === 'line') { if ((p1.x < p0.x) !== (p1.y < p0.y)) extra.flipH = true; h = Math.max(h, 0.01); w = Math.max(w, 0.01); }
        this.setTool(null);
        this.insertBox(kind, x, y, w, h, extra);
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }

    // ------------------------------------------------------------ red pencil
    drawInk(ev) {
      const k = this.scale * DPI;
      const live = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      live.setAttribute('class', 'ink-live');
      this.stage.append(live);
      const toS = (e) => { const p = this.toSlide(e); return [p.x, p.y]; };
      Ink.capture(ev, toS, (pts) => {
        live.innerHTML = `<path d="${Ink.pathD(pts.map(([x, y]) => [x * k, y * k]))}" stroke="${Ink.COLOR}" stroke-width="${(3 * 96 / 72) * this.scale}"/>`;
      }, (pts) => {
        live.remove();
        let sp = Ink.simplify(pts, 0.8 / k);
        if (sp.length === 1) sp = [sp[0], [sp[0][0] + 0.01, sp[0][1]]];
        const b = Ink.bbox(sp);
        const w = Math.max(b.x2 - b.x1, 0.02), h = Math.max(b.y2 - b.y1, 0.02);
        const e = { id: newId(), type: 'ink', x: b.x1, y: b.y1, w, h, rot: 0, vw: w, vh: h, color: Ink.COLOR, width: 3, paths: [sp.map(([x, y]) => [x - b.x1, y - b.y1])] };
        this.slide().elements.push(e);
        this.renderStage();
        this.commit();
      });
    }
    inkHit(e, p, tol) {
      const sx = (e.vw || e.w) / e.w, sy = (e.vh || e.h) / e.h;
      if (p.x < e.x - tol || p.x > e.x + e.w + tol || p.y < e.y - tol || p.y > e.y + e.h + tol) return false;
      const lp = [(p.x - e.x) * sx, (p.y - e.y) * sy];
      return e.paths.some((pts) => Ink.distToPolyline(lp, pts) / ((sx + sy) / 2) <= tol);
    }
    eraseInk(ev) {
      const tol = 8 / (this.scale * DPI);
      let removed = 0;
      const at = (e) => {
        const p = this.toSlide(e);
        const before = this.slide().elements.length;
        this.slide().elements = this.slide().elements.filter((x) => !(x.type === 'ink' && this.inkHit(x, p, tol)));
        if (this.slide().elements.length !== before) { removed++; this.sel.clear(); this.renderStage(); }
      };
      at(ev);
      const move = (e) => at(e);
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (removed) this.commit(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    clearInk() {
      const n = this.slide().elements.filter((x) => x.type === 'ink').length;
      if (!n) { toast('На этом слайде нет пометок'); return; }
      this.slide().elements = this.slide().elements.filter((x) => x.type !== 'ink');
      this.sel.clear();
      this.renderStage();
      this.commit();
      toast(`Удалено пометок: ${n}. Отменить — Ctrl+Z`);
    }

    snapLines(skip) {
      const xs = [0, this.model.width / 2, this.model.width], ys = [0, this.model.height / 2, this.model.height];
      for (const e of this.slide().elements) {
        if (skip.has(e.id) || e.rot) continue;
        xs.push(e.x, e.x + e.w / 2, e.x + e.w);
        ys.push(e.y, e.y + e.h / 2, e.y + e.h);
      }
      return { xs, ys };
    }
    dragMove(ev, p0) {
      const els = this.selected();
      const start = els.map((e) => ({ e, x: e.x, y: e.y }));
      const lines = this.snapLines(this.sel);
      const tol = 6 / (this.scale * DPI);
      let moved = false;
      const bb = () => { const xs = start.map((s) => s.e.x), ys = start.map((s) => s.e.y); return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...start.map((s) => s.e.x + s.e.w)), y2: Math.max(...start.map((s) => s.e.y + s.e.h)) }; };
      const move = (e) => {
        const p = this.toSlide(e);
        let dx = p.x - p0.x, dy = p.y - p0.y;
        if (!moved && Math.hypot(dx, dy) * this.scale * DPI < 3) return;
        moved = true;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        start.forEach((s) => { s.e.x = s.x + dx; s.e.y = s.y + dy; });
        // snapping guides
        this.stage.querySelectorAll('.guide').forEach((g) => g.remove());
        if (!e.altKey) {
          const b = bb();
          const cand = (vals, lines) => { let best = null; for (const v of vals) for (const l of lines) { const d = l - v; if (Math.abs(d) < tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, l }; } return best; };
          const sx = cand([b.x, (b.x + b.x2) / 2, b.x2], lines.xs), sy = cand([b.y, (b.y + b.y2) / 2, b.y2], lines.ys);
          const k = this.scale * DPI;
          if (sx) { start.forEach((s) => (s.e.x += sx.d)); this.stage.append(el('div', { class: 'guide', style: { left: sx.l * k + 'px', top: 0, width: '1px', height: '100%' } })); }
          if (sy) { start.forEach((s) => (s.e.y += sy.d)); this.stage.append(el('div', { class: 'guide', style: { top: sy.l * k + 'px', left: 0, height: '1px', width: '100%' } })); }
        }
        for (const s of start) { const d = this.elDom(s.e.id); if (d) { d.style.left = s.e.x * DPI + 'px'; d.style.top = s.e.y * DPI + 'px'; } }
        this.drawSelection();
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        this.stage.querySelectorAll('.guide').forEach((g) => g.remove());
        if (moved) this.commit();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    dragResize(ev, h) {
      ev.stopPropagation();
      const e = this.selected()[0];
      const s0 = { x: e.x, y: e.y, w: e.w, h: e.h };
      const p0 = this.toSlide(ev);
      const rad = ((e.rot || 0) * Math.PI) / 180;
      const ratio = s0.w / s0.h;
      const move = (m) => {
        const p = this.toSlide(m);
        // delta in element local frame
        const gx = p.x - p0.x, gy = p.y - p0.y;
        const dx = gx * Math.cos(rad) + gy * Math.sin(rad), dy = -gx * Math.sin(rad) + gy * Math.cos(rad);
        let { x, y, w, h: hh } = s0;
        if (h.includes('e')) w = s0.w + dx;
        if (h.includes('s')) hh = s0.h + dy;
        if (h.includes('w')) { w = s0.w - dx; x = s0.x + dx; }
        if (h.includes('n')) { hh = s0.h - dy; y = s0.y + dy; }
        const keep = (m.shiftKey || e.type === 'image') && h.length === 2 && !m.altKey;
        if (keep) {
          const nh = w / ratio;
          if (h.includes('n')) y = s0.y + s0.h - nh;
          hh = nh;
        }
        const min = e.geom === 'line' ? 0.01 : 0.15;
        if (w < min) { if (h.includes('w')) x -= min - w; w = min; }
        if (hh < min) { if (h.includes('n')) y -= min - hh; hh = min; }
        Object.assign(e, { x, y, w, h: hh });
        if (e.type === 'table') { const t = e.cols.reduce((a, b) => a + b, 0); e.cols = e.cols.map((c) => (c / t) * w); }
        const d = this.elDom(e.id);
        d.replaceWith(renderElement(e, { placeholders: true }));
        this.drawSelection();
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.commit(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    dragRotate(ev) {
      ev.stopPropagation();
      const e = this.selected()[0];
      const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
      const move = (m) => {
        const p = this.toSlide(m);
        let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (m.shiftKey) a = Math.round(a / 15) * 15;
        else { const r = Math.round(a / 90) * 90; if (Math.abs(a - r) < 3) a = r; }
        e.rot = ((Math.round(a) % 360) + 360) % 360;
        this.elDom(e.id).style.transform = e.rot ? `rotate(${e.rot}deg)` : '';
        this.drawSelection();
        this.status.textContent = `Поворот: ${e.rot}°`;
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.commit(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    marquee(ev, p0) {
      const box = el('div', { class: 'marquee' });
      this.stage.append(box);
      const k = this.scale * DPI;
      const base = new Set(this.sel);
      const move = (e) => {
        const p = this.toSlide(e);
        const x = Math.min(p0.x, p.x), y = Math.min(p0.y, p.y), w = Math.abs(p.x - p0.x), h = Math.abs(p.y - p0.y);
        Object.assign(box.style, { left: x * k + 'px', top: y * k + 'px', width: w * k + 'px', height: h * k + 'px' });
        this.sel = new Set(base);
        for (const el2 of this.slide().elements) if (el2.x < x + w && el2.x + el2.w > x && el2.y < y + h && el2.y + el2.h > y) this.sel.add(el2.id);
        this.drawSelection();
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); box.remove(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }

    onContext(ev) {
      ev.preventDefault();
      const d = ev.target.closest('.el');
      if (this.editing) return UI.menu(ev.clientX, ev.clientY, [
        { label: 'Вырезать', icon: 'x', onClick: () => document.execCommand('cut') },
        { label: 'Копировать', icon: 'copy', onClick: () => document.execCommand('copy') },
        { label: 'Вставить', icon: 'fileText', onClick: () => document.execCommand('paste') },
      ]);
      if (d && !this.sel.has(d.dataset.id)) { this.sel = new Set([d.dataset.id]); this.drawSelection(); }
      const e = d && this.find(d.dataset.id);
      const items = [];
      if (e) {
        if (e.type === 'box' && e.geom !== 'line') items.push({ label: 'Изменить текст', icon: 'text', onClick: () => this.startEdit(e.id) });
        if (e.type === 'table') {
          const td = ev.target.closest('td');
          const tr = td && td.parentElement;
          const ri = tr ? Array.from(tr.parentElement.children).indexOf(tr) : 0, ci = td ? Array.from(tr.children).indexOf(td) : 0;
          items.push({ label: 'Редактировать ячейки', icon: 'table', onClick: () => this.startEdit(e.id) },
            { label: 'Добавить строку ниже', icon: 'down', onClick: () => this.tableOp(e, 'addRow', ri, ci) },
            { label: 'Добавить столбец справа', icon: 'indent', onClick: () => this.tableOp(e, 'addCol', ri, ci) },
            { label: 'Удалить строку', icon: 'trash', onClick: () => this.tableOp(e, 'delRow', ri, ci) },
            { label: 'Удалить столбец', icon: 'trash', onClick: () => this.tableOp(e, 'delCol', ri, ci) }, '-');
        }
        items.push(
          { label: 'Копировать', icon: 'copy', key: 'Ctrl+C', onClick: () => this.copy() },
          { label: 'Вырезать', icon: 'x', key: 'Ctrl+X', onClick: () => { this.copy(); this.deleteSel(); } },
          { label: 'Дублировать', icon: 'dup', key: 'Ctrl+D', onClick: () => this.duplicate() },
          '-',
          { label: 'На передний план', icon: 'front', onClick: () => this.order(1) },
          { label: 'На задний план', icon: 'back', onClick: () => this.order(-1) },
          '-',
          { label: 'Удалить', icon: 'trash', key: 'Del', onClick: () => this.deleteSel() });
      } else {
        items.push({ label: 'Вставить', icon: 'fileText', key: 'Ctrl+V', disabled: !this.clip, onClick: () => this.paste() },
          { label: 'Выделить всё', icon: 'cursor', key: 'Ctrl+A', onClick: () => { this.sel = new Set(this.slide().elements.map((x) => x.id)); this.drawSelection(); } },
          '-', { label: 'Карандаш (пометки)', icon: 'pencil', onClick: () => this.setTool('pencil') },
          { label: 'Удалить все пометки на слайде', icon: 'inkClear', onClick: () => this.clearInk() },
          '-', { label: 'Новый слайд', icon: 'plus', onClick: () => this.addSlide('content') });
      }
      UI.menu(ev.clientX, ev.clientY, items);
    }

    // ------------------------------------------------------------ keyboard & clipboard
    copy() { const s = this.selected(); if (s.length) this.clip = clone(s); }
    paste() {
      if (!this.clip) return;
      const ids = [];
      for (const c of this.clip) { const e = clone(c); e.id = newId(); e.x += 0.25; e.y += 0.25; this.slide().elements.push(e); ids.push(e.id); }
      this.clip = this.clip.map((c) => ({ ...c, x: c.x + 0.25, y: c.y + 0.25 }));
      this.sel = new Set(ids);
      this.renderStage();
      this.commit();
    }
    duplicate() { this.copy(); this.paste(); }
    deleteSel() {
      if (!this.sel.size) return;
      this.slide().elements = this.slide().elements.filter((e) => !this.sel.has(e.id));
      this.sel.clear();
      this.renderStage();
      this.commit();
    }
    onKey(ev) {
      if (this.editing) {
        if (ev.key === 'Escape') { ev.preventDefault(); this.commitEdit(); this.stageWrap.focus(); }
        return;
      }
      const ctrl = ev.ctrlKey || ev.metaKey;
      const k = ev.key;
      if (k === 'F5') { ev.preventDefault(); this.present(ev.shiftKey ? this.cur : 0); return; }
      if (k === 'Escape') { this.setTool(null); this.sel.clear(); this.drawSelection(); return; }
      if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); if (this.sel.size) this.deleteSel(); else if (ev.target === this.thumbs) this.deleteSlide(this.cur); return; }
      if (ctrl && k.toLowerCase() === 'c') { ev.preventDefault(); this.copy(); return; }
      if (ctrl && k.toLowerCase() === 'x') { ev.preventDefault(); this.copy(); this.deleteSel(); return; }
      if (ctrl && k.toLowerCase() === 'v') { if (this.clip) { ev.preventDefault(); this.paste(); } return; }
      if (ctrl && k.toLowerCase() === 'd') { ev.preventDefault(); this.duplicate(); return; }
      if (ctrl && k.toLowerCase() === 'a') { ev.preventDefault(); this.sel = new Set(this.slide().elements.map((x) => x.id)); this.drawSelection(); return; }
      if (ctrl && k.toLowerCase() === 'b') { ev.preventDefault(); this.toggleRun('b', 'bold'); return; }
      if (ctrl && k.toLowerCase() === 'i') { ev.preventDefault(); this.toggleRun('i', 'italic'); return; }
      if (ctrl && k.toLowerCase() === 'u') { ev.preventDefault(); this.toggleRun('u', 'underline'); return; }
      if (k === 'PageDown' || (!this.sel.size && (k === 'ArrowDown' || k === 'ArrowRight'))) { ev.preventDefault(); this.go(this.cur + 1); return; }
      if (k === 'PageUp' || (!this.sel.size && (k === 'ArrowUp' || k === 'ArrowLeft'))) { ev.preventDefault(); this.go(this.cur - 1); return; }
      if (k === 'Enter' && this.sel.size === 1) { ev.preventDefault(); this.startEdit([...this.sel][0]); return; }
      if (k.startsWith('Arrow') && this.sel.size) {
        ev.preventDefault();
        const step = ev.shiftKey ? 0.25 : 1 / DPI * 2;
        const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[k];
        this.selected().forEach((e) => { e.x += d[0]; e.y += d[1]; });
        this.renderStage();
        this.dirtySoon();
      }
    }

    // ------------------------------------------------------------ slideshow
    present(start) {
      this.commitEdit();
      let i = start || 0;
      const ov = el('div', { class: 'show-overlay', tabindex: '0' });
      const counter = el('div', { class: 'counter' });
      document.body.append(ov);
      const show = () => {
        ov.querySelectorAll('.slide').forEach((s) => s.remove());
        const s = renderSlide(this.model, this.model.slides[i]);
        const k = Math.min(innerWidth / (this.model.width * DPI), innerHeight / (this.model.height * DPI));
        s.style.transform = `scale(${k})`;
        s.style.left = (innerWidth - this.model.width * DPI * k) / 2 + 'px';
        s.style.top = (innerHeight - this.model.height * DPI * k) / 2 + 'px';
        ov.prepend(s);
        counter.textContent = `${i + 1} / ${this.model.slides.length}`;
      };
      const end = () => {
        removeEventListener('resize', show);
        ov.remove();
        if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
        this.stageWrap.focus();
      };
      const step = (d) => { const n = i + d; if (n >= this.model.slides.length) return end(); i = Math.max(0, n); show(); };
      ov.append(counter);
      ov.addEventListener('keydown', (e) => {
        e.preventDefault();
        if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) step(1);
        else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) step(-1);
        else if (e.key === 'Home') { i = 0; show(); }
        else if (e.key === 'End') { i = this.model.slides.length - 1; show(); }
        else if (e.key === 'Escape') end();
      });
      ov.addEventListener('mousedown', (e) => step(e.button === 2 ? -1 : 1));
      ov.addEventListener('contextmenu', (e) => e.preventDefault());
      document.addEventListener('fullscreenchange', function fc() { if (!document.fullscreenElement) { document.removeEventListener('fullscreenchange', fc); if (ov.isConnected) end(); } });
      addEventListener('resize', show);
      document.documentElement.requestFullscreen().catch(() => {});
      show();
      ov.focus();
    }

    // ------------------------------------------------------------ editor API
    getData() {
      this.commitEdit();
      const m = clone(this.model);
      m.slides.forEach((s) => s.elements.forEach((e) => { delete e.defaults; delete e.ph; }));
      return { model: m };
    }
    /** every slide as one page of the slide's own size */
    printPayload() {
      this.commitEdit();
      const wMm = this.model.width * 25.4, hMm = this.model.height * 25.4;
      const html = this.model.slides.map((sl) => `<div class="os-pg">${renderSlide(this.model, sl).outerHTML}</div>`).join('');
      const css = UI.appCss((r) => /\.slide|\.el\b|\.txt|\.tbl|ink-svg|\.shape/.test(r.selectorText || '') || r.type === CSSRule.FONT_FACE_RULE) +
        `\n.os-pg { width: ${wMm}mm; height: ${hMm}mm; overflow: hidden; font: 13px/1.4 'Segoe UI', system-ui, Roboto, Arial, sans-serif; color: #1d2330; page-break-after: always; break-after: page; position: relative; }
        .os-pg:last-child { page-break-after: auto; break-after: auto; }
        .os-pg > .slide { position: absolute; left: 0; top: 0; }`;
      return { html, css, widthMm: wMm, heightMm: hMm, suggestedName: (window.App && App.active() && App.active().name) || 'Презентация' };
    }
    async exportMenu() {
      toast('Готовлю PDF…');
      const r = await window.api.printHtml({ ...this.printPayload(), action: 'pdf' });
      if (r.ok) toast('PDF сохранён: ' + r.path.split(/[\\/]/).pop());
      else if (!r.canceled) toast('Ошибка экспорта: ' + r.error, 'error');
    }
    async printPreview() {
      toast('Готовлю предпросмотр…');
      const r = await window.api.printHtml({ ...this.printPayload(), action: 'preview' });
      if (!r.ok && !r.canceled) toast('Ошибка печати: ' + r.error, 'error');
    }
    onActivate() { requestAnimationFrame(() => { this.layoutStage(); this.stageWrap.focus({ preventScroll: true }); }); }
    destroy() { this.ro.disconnect(); }
  }

  window.SlideEditor = SlideEditor;
})();
