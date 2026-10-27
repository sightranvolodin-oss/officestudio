/* Word-like document editor (contenteditable page) */
(function () {
  const { el, btn, group, select, colorButton, toast, modal, esc } = UI;
  const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Georgia', 'Verdana', 'Tahoma', 'Segoe UI', 'Courier New', 'Cambria', 'Trebuchet MS'];
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];
  const MMPX = 96 / 25.4; // px per millimetre
  const SHEET_GAP = 24; // px between sheets on screen
  const DEFAULT_PAGE = { w: 210, h: 297, mt: 20, mb: 20, ml: 30, mr: 15 }; // A4, Russian default margins (mm)
  const CM = 96 / 2.54; // px per centimetre
  const setStyleAttr = (e, v) => (v == null ? e.removeAttribute('style') : e.setAttribute('style', v));

  /** Word-like horizontal ruler: margins, first-line / hanging / left / right indent markers */
  class Ruler {
    constructor(ed) {
      this.ed = ed;
      this.canvas = el('canvas', { class: 'ruler-canvas' });
      const mk = (cls, title, svg) => el('div', { class: 'ruler-mk ' + cls, title, html: svg });
      const down = '<svg width="11" height="8" viewBox="0 0 11 8"><path d="M.5.5h10L5.5 7.5z" fill="#fff" stroke="#55606e"/></svg>';
      const up = '<svg width="11" height="8" viewBox="0 0 11 8"><path d="M.5 7.5h10L5.5.5z" fill="#fff" stroke="#55606e"/></svg>';
      this.mFirst = mk('first', 'Отступ первой строки (красная строка)', down);
      this.mHang = mk('hang', 'Выступ (отступ остальных строк)', up);
      this.mLeft = mk('left', 'Отступ слева (весь абзац)', '<svg width="11" height="6" viewBox="0 0 11 6"><rect x=".5" y=".5" width="10" height="5" fill="#fff" stroke="#55606e"/></svg>');
      this.mRight = mk('right', 'Отступ справа', up);
      this.track = el('div', { class: 'ruler-track' }, [this.canvas, this.mFirst, this.mHang, this.mLeft, this.mRight]);
      this.tip = el('div', { class: 'ruler-tip' });
      this.el = el('div', { class: 'ruler' }, [this.track, this.tip]);
      this.guide = el('div', { class: 'ruler-guide' });
      this.vals = null;
    }
    bind() {
      const ed = this.ed;
      ed.scroll.addEventListener('scroll', () => this.place());
      this.ro = new ResizeObserver(() => this.update());
      this.ro.observe(ed.scroll);
      for (const [m, kind] of [[this.mFirst, 'first'], [this.mHang, 'hang'], [this.mLeft, 'left'], [this.mRight, 'right']]) {
        m.addEventListener('mousedown', (e) => this.drag(e, kind));
      }
      this.track.addEventListener('dblclick', (e) => { if (!e.target.closest('.ruler-mk')) ed.paragraphDialog(); });
      ed.root.append(this.guide);
      this.update();
    }
    destroy() { if (this.ro) this.ro.disconnect(); }
    /** keeps the ruler aligned with the page horizontally */
    place() {
      const ed = this.ed;
      const pr = ed.page.getBoundingClientRect(), rr = this.el.getBoundingClientRect();
      if (!pr.width) return;
      this.track.style.left = pr.left - rr.left + 'px';
      this.track.style.width = pr.width + 'px';
    }
    update() {
      const ed = this.ed;
      if (!ed.page.isConnected || !this.el.offsetParent) return;
      this.place();
      const z = ed.zoom;
      const G = ed.geom, w = G.W * z, h = 22;
      const d = window.devicePixelRatio || 1;
      if (this.canvas.width !== Math.round(w * d) || this.lastZ !== z || this.lastG !== G.key) {
        this.lastZ = z; this.lastG = G.key;
        this.canvas.width = Math.round(w * d); this.canvas.height = Math.round(h * d);
        this.canvas.style.width = w + 'px'; this.canvas.style.height = h + 'px';
        this.draw(z, w, h, d);
      }
      const blocks = ed.selectedBlocks();
      if (!blocks.length) { this.track.classList.add('idle'); return; }
      this.track.classList.remove('idle');
      this.vals = ed.blockIndents(blocks[0]);
      this.placeMarkers();
    }
    placeMarkers() {
      const z = this.ed.zoom, v = this.vals, G = this.ed.geom;
      const x = (px) => (G.ml + px) * z;
      this.mFirst.style.left = x(v.first) + 'px';
      this.mHang.style.left = x(v.left) + 'px';
      this.mLeft.style.left = x(v.left) + 'px';
      this.mRight.style.left = (G.W - G.mr - v.right) * z + 'px';
    }
    draw(z, w, h, d) {
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, w, h);
      // margins grey, text area white
      ctx.fillStyle = '#d7dbe2';
      ctx.fillRect(0, 3, w, h - 6);
      ctx.fillStyle = '#ffffff';
      const G = this.ed.geom;
      ctx.fillRect(G.ml * z, 3, (G.W - G.ml - G.mr) * z, h - 6);
      ctx.strokeStyle = '#9aa3b0';
      ctx.fillStyle = '#4a5260';
      ctx.font = '10px Segoe UI, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const zero = G.ml * z;
      ctx.beginPath();
      for (let k = -Math.floor(G.ml / (CM / 4)); ; k++) {
        const px = zero + k * (CM / 4) * z;
        if (px > w) break;
        if (px < 0) continue;
        if (k % 4 === 0) {
          if (k !== 0) ctx.fillText(String(Math.abs(k / 4)), px, h / 2);
        } else {
          const len = k % 2 === 0 ? 5 : 2;
          ctx.moveTo(Math.round(px) + 0.5, h / 2 - len / 2); ctx.lineTo(Math.round(px) + 0.5, h / 2 + len / 2);
        }
      }
      ctx.stroke();
    }
    drag(e, kind) {
      e.preventDefault();
      e.stopPropagation();
      const ed = this.ed;
      const blocks = ed.selectedBlocks();
      if (!blocks.length) return;
      const z = ed.zoom;
      const start = blocks.map((b) => ({ b, i: ed.blockIndents(b), ml: parseFloat(b.style.marginLeft) || 0, mr: parseFloat(b.style.marginRight) || 0 }));
      const before = blocks.map((b) => b.getAttribute('style'));
      const x0 = e.clientX;
      const v0 = this.vals;
      const sr = ed.scroll.getBoundingClientRect(), rr = ed.root.getBoundingClientRect();
      this.guide.style.top = sr.top - rr.top + 'px';
      this.guide.style.height = sr.height + 'px';
      this.guide.style.display = 'block';
      const step = CM / 4;
      const move = (m) => {
        let dx = (m.clientX - x0) / z;
        // snap the marker to 0.25 cm (Alt — without snapping)
        const base = kind === 'first' ? v0.first : kind === 'right' ? -v0.right : v0.left;
        if (!m.altKey) dx = Math.round((base + dx) / step) * step - base;
        for (const s0 of start) {
          const st = s0.b.style;
          if (kind === 'first') {
            const ti = Math.round(s0.i.ti + dx);
            st.textIndent = ti ? ti + 'px' : '';
          } else if (kind === 'hang') {
            // left edge moves, the first line stays where it is
            const ml = Math.round(s0.ml + dx), ti = Math.round(s0.i.ti - dx);
            st.marginLeft = ml ? ml + 'px' : '';
            st.textIndent = ti ? ti + 'px' : '';
          } else if (kind === 'left') {
            const ml = Math.round(s0.ml + dx);
            st.marginLeft = ml ? ml + 'px' : '';
          } else {
            const mr = Math.round(s0.mr - dx);
            st.marginRight = mr ? mr + 'px' : '';
          }
        }
        this.vals = ed.blockIndents(blocks[0]);
        this.placeMarkers();
        const G = ed.geom;
        const pos = kind === 'first' ? this.vals.first : kind === 'right' ? G.W - G.ml - G.mr - this.vals.right : this.vals.left;
        const pr = ed.page.getBoundingClientRect();
        this.guide.style.left = pr.left - rr.left + (G.ml + pos) * z + 'px';
        const shown = kind === 'right' ? this.vals.right : kind === 'first' ? this.vals.first - this.vals.left : this.vals.left;
        this.tip.textContent = `${{ first: 'Первая строка', hang: 'Выступ', left: 'Слева', right: 'Справа' }[kind]}: ${(shown / CM).toFixed(2).replace('.', ',')} см`;
        this.tip.style.left = this.track.offsetLeft + (G.ml + pos) * z + 'px';
        this.tip.style.display = 'block';
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        this.guide.style.display = 'none';
        this.tip.style.display = 'none';
        const after = blocks.map((b) => b.getAttribute('style'));
        if (before.some((v, i) => v !== after[i])) {
          ed.paraUndo.push({ els: blocks, before, after, seq: ed.editSeq });
          ed.paraRedo = [];
          ed.changed();
        }
        ed.restoreSel && ed.restoreSel();
        this.update();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
  }

  class DocEditor {
    constructor(root, data, { onDirty }) {
      this.root = root;
      this.onDirty = onDirty;
      this.zoom = 1;
      this.textColor = '#c00000';
      this.hlColor = '#ffff00';

      // page setup, header and footer (saved into the .docx section properties)
      const dm = data.doc || {};
      this.meta = { page: { ...DEFAULT_PAGE, ...(dm.page || {}) }, header: dm.header || '', footer: dm.footer || '', headerAlign: dm.headerAlign || 'center', footerAlign: dm.footerAlign || 'center' };
      if (!data.doc && data.html && data.html !== '<p><br></p>') this.meta.page = { w: 210, h: 297, mt: 25.4, mb: 25.4, ml: 23.8, mr: 23.8 };
      this.page = el('div', { class: 'doc-page', contenteditable: 'true', spellcheck: 'true' });
      this.page.innerHTML = this.sanitize(data.html || '<p><br></p>');
      this.sheets = el('div', { class: 'doc-sheets' });
      this.zoomBox = el('div', { class: 'doc-zoom' }, [this.sheets, this.page]);
      this.applyGeom();
      this.scroll = el('div', { class: 'doc-scroll' }, this.zoomBox);
      this.scroll.style.position = 'relative';

      // red pencil layer on top of the page (coordinates = page px)
      this.inks = [];
      this.inkUndo = [];
      this.paraUndo = [];
      this.paraRedo = [];
      this.editSeq = 0;
      this.inkMode = null;
      this.inkLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.inkLayer.setAttribute('class', 'ink-layer');
      this.zoomBox.append(this.inkLayer);

      this.ruler = new Ruler(this);
      root.append(this.buildToolbar(), this.ruler.el, this.scroll, this.buildStatus());
      this.bind();
      this.ruler.bind();
      this.bindInk();
      requestAnimationFrame(() => this.loadInkMarkers());
      this.updateCounts();
      setTimeout(() => this.focusStart(), 30);
      // pagination after layout and whenever content or images change
      this.page.addEventListener('load', () => this.schedulePaginate(), true);
      requestAnimationFrame(() => this.paginate());
    }

    // ------------------------------------------------------------ pages
    /** page geometry in px from the page setup (mm) */
    applyGeom() {
      const p = this.meta.page;
      const g = { W: Math.round(p.w * MMPX), H: Math.round(p.h * MMPX), mt: p.mt * MMPX, mb: p.mb * MMPX, ml: p.ml * MMPX, mr: p.mr * MMPX };
      g.key = [g.W, g.H, g.mt, g.mb, g.ml, g.mr].join(',');
      this.geom = g;
      const st = this.page.style;
      st.width = g.W + 'px';
      st.padding = `${g.mt}px ${g.mr}px ${g.mb}px ${g.ml}px`;
      this.zoomBox.style.width = g.W + 'px';
      if (this.inkLayer) this.inkLayer.setAttribute('width', g.W);
      if (this.ruler) this.ruler.update();
    }
    innerW() { return Math.round(this.geom.W - this.geom.ml - this.geom.mr); }
    schedulePaginate() { clearTimeout(this.pgT); this.pgT = setTimeout(() => this.paginate(), 120); }
    /** flow blocks for pagination: top-level blocks, list items, table rows */
    flowBlocks() {
      const out = [];
      const walk = (parent) => {
        for (const c of parent.children) {
          if (c.tagName === 'UL' || c.tagName === 'OL') walk(c);
          else if (c.tagName === 'TABLE') { for (const tr of c.rows) out.push(tr); }
          else out.push(c);
        }
      };
      walk(this.page);
      return out;
    }
    /**
     * Word-like pages: a block that would cross the bottom margin is pushed to the next page with a
     * temporary margin (never saved). Table rows are pushed with cell padding.
     */
    paginate() {
      if (!this.page.isConnected) return;
      const g = this.geom, z = this.zoom;
      const contentH = g.H - g.mt - g.mb, pitch = g.H + SHEET_GAP;
      // reset previous pushes
      this.page.querySelectorAll('.pg-push').forEach((b) => { b.classList.remove('pg-push'); b.style.removeProperty('--pg'); if (!b.getAttribute('style')) b.removeAttribute('style'); if (!b.className) b.removeAttribute('class'); });
      const top0 = () => this.page.getBoundingClientRect().top / z + g.mt;
      const t0 = top0();
      let forceNext = false;
      const pages = []; // page index of every heading (for the table of contents)
      for (const b of this.flowBlocks()) {
        if (b.classList.contains('page-break')) { forceNext = true; continue; }
        const r = b.getBoundingClientRect();
        let y = r.top / z - t0;
        const h = r.height / z;
        const pi = Math.floor(y / pitch);
        const local = y - pi * pitch;
        let target = null;
        if (forceNext && local > 0.5) target = (pi + 1) * pitch;
        else if (local >= contentH - 0.5) target = (pi + 1) * pitch;
        else if (local + h > contentH + 0.5 && h <= contentH && local > 0.5) target = (pi + 1) * pitch;
        forceNext = false;
        if (target != null) {
          // margins collapse with the previous block, so measure and correct once
          let push = target - y;
          for (let k = 0; k < 2 && Math.abs(push) > 0.5; k++) {
            const cur = parseFloat(b.style.getPropertyValue('--pg')) || 0;
            b.classList.add('pg-push');
            b.style.setProperty('--pg', Math.max(0, cur + push) + 'px');
            y = b.getBoundingClientRect().top / z - t0;
            push = target - y;
          }
        }
        if (/^H[1-3]$/.test(b.tagName)) pages.push([b, Math.floor((b.getBoundingClientRect().top / z - t0) / pitch) + 1]);
      }
      const bottom = this.page.scrollHeight;
      const n = Math.max(1, Math.ceil((bottom - g.mb + 1) / pitch));
      this.pageCount = n;
      this.page.style.minHeight = n * pitch - SHEET_GAP + 'px';
      this.renderSheets(n);
      this.headingPages = pages;
      this.refreshToc();
      if (this.countEl) this.updateCounts();
    }
    renderSheets(n) {
      const g = this.geom, m = this.meta;
      const fill = (t, i) => (t || '').replace(/\{PAGE\}/g, String(i + 1)).replace(/\{NUMPAGES\}/g, String(n));
      this.sheets.innerHTML = '';
      for (let i = 0; i < n; i++) {
        const sh = el('div', { class: 'doc-sheet', style: { top: i * (g.H + SHEET_GAP) + 'px', height: g.H + 'px', width: g.W + 'px' } });
        if (m.header) sh.append(el('div', { class: 'doc-hf head', title: 'Верхний колонтитул — двойной щелчок, чтобы изменить', style: { left: g.ml + 'px', right: g.mr + 'px', top: Math.max(8, g.mt * 0.38) + 'px', textAlign: m.headerAlign }, text: fill(m.header, i) }));
        if (m.footer) sh.append(el('div', { class: 'doc-hf foot', title: 'Нижний колонтитул — двойной щелчок, чтобы изменить', style: { left: g.ml + 'px', right: g.mr + 'px', bottom: Math.max(8, g.mb * 0.38) + 'px', textAlign: m.footerAlign }, text: fill(m.footer, i) }));
        this.sheets.append(sh);
      }
    }
    async pageSetupDialog() {
      const p = this.meta.page;
      const sizes = { A4: [210, 297], A3: [297, 420], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
      const short = Math.min(p.w, p.h), long = Math.max(p.w, p.h);
      const cur = Object.keys(sizes).find((k) => Math.abs(sizes[k][0] - short) < 1 && Math.abs(sizes[k][1] - long) < 1) || 'A4';
      const r = await modal({
        title: 'Параметры страницы',
        fields: [
          { name: 'size', label: 'Размер бумаги', type: 'select', options: [['A4', 'A4 (210 × 297 мм)'], ['A3', 'A3 (297 × 420 мм)'], ['A5', 'A5 (148 × 210 мм)'], ['Letter', 'Letter (216 × 279 мм)'], ['Legal', 'Legal (216 × 356 мм)']], value: cur },
          { name: 'orient', label: 'Ориентация', type: 'select', options: [['port', 'Книжная'], ['land', 'Альбомная']], value: p.w > p.h ? 'land' : 'port' },
          { name: 'mt', label: 'Поле сверху, мм', type: 'number', value: +p.mt.toFixed(1), min: 0, max: 100 },
          { name: 'mb', label: 'Поле снизу, мм', type: 'number', value: +p.mb.toFixed(1), min: 0, max: 100 },
          { name: 'ml', label: 'Поле слева, мм', type: 'number', value: +p.ml.toFixed(1), min: 0, max: 100 },
          { name: 'mr', label: 'Поле справа, мм', type: 'number', value: +p.mr.toFixed(1), min: 0, max: 100 },
        ],
        okText: 'Применить',
      });
      if (!r) return;
      const [a, b] = sizes[r.size] || sizes.A4;
      const land = r.orient === 'land';
      const num = (v, d) => (isFinite(v) && v >= 0 ? v : d);
      this.meta.page = { w: land ? b : a, h: land ? a : b, mt: num(r.mt, p.mt), mb: num(r.mb, p.mb), ml: num(r.ml, p.ml), mr: num(r.mr, p.mr) };
      this.applyGeom();
      this.paginate();
      this.onDirty();
    }
    async headerFooterDialog(focus) {
      const m = this.meta;
      const hint = el('div', { class: 'print-hint', html: 'В тексте можно использовать <b>{PAGE}</b> — номер страницы и <b>{NUMPAGES}</b> — число страниц. Например: «Стр. {PAGE} из {NUMPAGES}».' });
      const r = await modal({
        title: 'Колонтитулы',
        fields: [
          { name: 'header', label: 'Верхний колонтитул', type: 'textarea', value: m.header },
          { name: 'headerAlign', label: 'Выравнивание верхнего', type: 'select', options: [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']], value: m.headerAlign },
          { name: 'footer', label: 'Нижний колонтитул', type: 'textarea', value: m.footer },
          { name: 'footerAlign', label: 'Выравнивание нижнего', type: 'select', options: [['left', 'Слева'], ['center', 'По центру'], ['right', 'Справа']], value: m.footerAlign },
        ],
        body: hint,
        okText: 'Применить',
      });
      if (!r) return;
      Object.assign(m, { header: r.header.trim(), footer: r.footer.trim(), headerAlign: r.headerAlign, footerAlign: r.footerAlign });
      this.renderSheets(this.pageCount || 1);
      this.onDirty();
      void focus;
    }
    pageNumbersMenu(b) {
      const set = (where, align) => {
        const m = this.meta;
        if (where === 'none') {
          m.header = m.header.replace(/\s*\{PAGE\}( из \{NUMPAGES\})?/g, '').trim();
          m.footer = m.footer.replace(/\s*(Стр\. )?\{PAGE\}( из \{NUMPAGES\})?/g, '').trim();
        } else {
          const t = align === 'center' ? '{PAGE}' : 'Стр. {PAGE} из {NUMPAGES}';
          if (where === 'bottom') { m.footer = t; m.footerAlign = align; } else { m.header = t; m.headerAlign = align; }
        }
        this.renderSheets(this.pageCount || 1);
        this.onDirty();
      };
      const r = b.getBoundingClientRect();
      UI.menu(r.left, r.bottom + 4, [
        { label: 'Внизу по центру', onClick: () => set('bottom', 'center') },
        { label: 'Внизу справа («Стр. 1 из 5»)', onClick: () => set('bottom', 'right') },
        { label: 'Вверху справа', onClick: () => set('top', 'right') },
        '-',
        { label: 'Колонтитулы…', icon: 'text', onClick: () => this.headerFooterDialog() },
        { label: 'Убрать номера страниц', icon: 'x', onClick: () => set('none') },
      ]);
    }
    /** table of contents from Заголовок 1–3, with page numbers */
    insertToc() {
      this.exec('insertHTML', '<div class="toc" contenteditable="false"></div><p><br></p>');
      this.paginate();
      toast('Оглавление вставлено. Номера страниц обновляются сами.');
    }
    refreshToc() {
      const tocs = this.page.querySelectorAll('.toc');
      if (!tocs.length) return;
      const items = (this.headingPages || []).filter(([h]) => !h.closest('.toc'));
      const html = '<div class="toc-title">Оглавление</div>' + (items.length ? items.map(([h, pg], i) => `<div class="toc-e toc-l${h.tagName[1]}" data-i="${i}"><span class="t">${UI.esc(h.textContent.trim() || '—')}</span><span class="d"></span><span class="n">${pg}</span></div>`).join('') : '<div class="toc-empty">Нет заголовков. Сделайте строки «Заголовком 1–3» (список стилей слева на панели).</div>');
      tocs.forEach((t) => { if (t.innerHTML !== html) t.innerHTML = html; });
      this.tocTargets = items.map(([h]) => h);
    }

    focusStart() {
      this.page.focus();
      const r = document.createRange();
      r.setStart(this.page, 0);
      r.collapse(true);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }

    // ------------------------------------------------------------ toolbar
    buildToolbar() {
      const cmd = (c, v = null, css = false) => () => this.exec(c, v, css);
      this.fontSel = select(FONTS, { title: 'Шрифт', width: 122, onChange: (v) => this.exec('fontName', v, true) });
      this.sizeSel = select(SIZES.map((s) => [String(s), String(s)]), { title: 'Размер шрифта', width: 62, onChange: (v) => this.setFontSize(+v) });
      this.styleSel = select([['p', 'Обычный'], ['h1', 'Заголовок 1'], ['h2', 'Заголовок 2'], ['h3', 'Заголовок 3'], ['blockquote', 'Цитата']], { title: 'Стиль абзаца', width: 116, onChange: (v) => this.exec('formatBlock', v) });
      for (const s of [this.fontSel, this.sizeSel, this.styleSel]) s.addEventListener('mousedown', () => this.saveSel());
      this.stateBtns = {
        bold: btn({ icon: 'bold', title: 'Полужирный (Ctrl+B)', onClick: cmd('bold') }),
        italic: btn({ icon: 'italic', title: 'Курсив (Ctrl+I)', onClick: cmd('italic') }),
        underline: btn({ icon: 'underline', title: 'Подчёркнутый (Ctrl+U)', onClick: cmd('underline') }),
        strikeThrough: btn({ icon: 'strike', title: 'Зачёркнутый', onClick: cmd('strikeThrough') }),
        superscript: btn({ icon: 'sup', title: 'Надстрочный', onClick: cmd('superscript') }),
        subscript: btn({ icon: 'sub', title: 'Подстрочный', onClick: cmd('subscript') }),
        justifyLeft: btn({ icon: 'alignLeft', title: 'По левому краю', onClick: cmd('justifyLeft') }),
        justifyCenter: btn({ icon: 'alignCenter', title: 'По центру', onClick: cmd('justifyCenter') }),
        justifyRight: btn({ icon: 'alignRight', title: 'По правому краю', onClick: cmd('justifyRight') }),
        justifyFull: btn({ icon: 'alignJustify', title: 'По ширине', onClick: cmd('justifyFull') }),
        insertUnorderedList: btn({ icon: 'listUl', title: 'Маркированный список', onClick: cmd('insertUnorderedList') }),
        insertOrderedList: btn({ icon: 'listOl', title: 'Нумерованный список', onClick: cmd('insertOrderedList') }),
      };
      const sb = this.stateBtns;
      const colorBtn = colorButton({ icon: 'textColor', title: 'Цвет текста', get: () => this.textColor, onPick: (c) => { this.textColor = c; this.exec('foreColor', c, true); } });
      const hlBtn = colorButton({ icon: 'highlight', title: 'Цвет выделения', allowNone: true, noneLabel: 'Без заливки', get: () => this.hlColor, onPick: (c) => { if (c) this.hlColor = c; this.exec('hiliteColor', c || 'transparent', true); } });
      const tableBtn = btn({ icon: 'table', title: 'Вставить таблицу', onClick: (e, b) => UI.gridPicker(b, (r, c) => this.insertTable(r, c)) });

      return el('div', { class: 'toolbar' }, [
        group(btn({ icon: 'undo', title: 'Отменить (Ctrl+Z)', onClick: () => this.undo() }), btn({ icon: 'redo', title: 'Повторить (Ctrl+Y)', onClick: () => this.redo() })),
        group(this.styleSel, this.fontSel, this.sizeSel),
        group(sb.bold, sb.italic, sb.underline, sb.strikeThrough, sb.superscript, sb.subscript, colorBtn, hlBtn, btn({ icon: 'eraser', title: 'Очистить форматирование', onClick: cmd('removeFormat') })),
        group(sb.justifyLeft, sb.justifyCenter, sb.justifyRight, sb.justifyFull),
        group(sb.insertUnorderedList, sb.insertOrderedList, btn({ icon: 'outdent', title: 'Уменьшить отступ', onClick: () => this.stepIndent(-1) }), btn({ icon: 'indent', title: 'Увеличить отступ', onClick: () => this.stepIndent(1) }), btn({ icon: 'slideLayout', label: 'Абзац', title: 'Отступы и интервалы абзаца', onClick: () => this.paragraphDialog() })),
        group(
          tableBtn,
          btn({ icon: 'image', title: 'Вставить изображение', onClick: () => this.insertImage() }),
          btn({ icon: 'link', title: 'Ссылка', onClick: () => this.insertLink() }),
          btn({ icon: 'hr', title: 'Горизонтальная линия', onClick: cmd('insertHorizontalRule') }),
          btn({ icon: 'pageBreak', title: 'Разрыв страницы', onClick: () => this.exec('insertHTML', '<div class="page-break" contenteditable="false"></div><p><br></p>') }),
        ),
        group(
          (this.penBtn = btn({ icon: 'pencil', label: 'Карандаш', cls: 'pencil', title: 'Красный карандаш: рисуйте пометки поверх документа (Esc — выход)', keepFocus: false, onClick: () => this.setInkMode(this.inkMode === 'pencil' ? null : 'pencil') })),
          (this.eraserBtn = btn({ icon: 'eraser', title: 'Ластик для пометок', keepFocus: false, onClick: () => this.setInkMode(this.inkMode === 'eraser' ? null : 'eraser') })),
          btn({ icon: 'inkClear', title: 'Удалить все пометки', keepFocus: false, onClick: () => this.clearInk() }),
        ),
        group(
          btn({ icon: 'fileText', label: 'Страница', title: 'Размер, ориентация и поля страницы', onClick: () => this.pageSetupDialog() }),
          btn({ icon: 'listOl', label: '№ стр.', title: 'Номера страниц и колонтитулы', onClick: (e, b) => this.pageNumbersMenu(b) }),
          btn({ icon: 'listUl', label: 'Оглавление', title: 'Вставить оглавление по заголовкам', onClick: () => this.insertToc() }),
        ),
        group(btn({ icon: 'search', title: 'Найти и заменить (Ctrl+F)', onClick: () => this.find() }), btn({ icon: 'pdf', label: 'PDF', title: 'Экспорт в PDF (Ctrl+E)', onClick: () => this.exportMenu() }), btn({ icon: 'download', label: 'Печать', title: 'Предпросмотр и печать (Ctrl+P)', onClick: () => this.printPreview() })),
      ]);
    }

    buildStatus() {
      this.countEl = el('span');
      this.zoomLbl = el('span', { text: '100%', style: { minWidth: '38px', textAlign: 'right' } });
      const range = el('input', { type: 'range', min: '50', max: '200', step: '10', value: '100', title: 'Масштаб' });
      range.addEventListener('input', () => this.setZoom(+range.value / 100));
      this.zoomRange = range;
      return el('div', { class: 'statusbar' }, [el('span', { text: 'Документ Word' }), this.countEl, el('span', { class: 'spacer' }), range, this.zoomLbl]);
    }

    setZoom(z) {
      this.zoom = Math.max(0.5, Math.min(2, z));
      this.zoomBox.style.zoom = this.zoom;
      this.zoomLbl.textContent = Math.round(this.zoom * 100) + '%';
      this.zoomRange.value = Math.round(this.zoom * 100);
      if (this.ruler) this.ruler.update();
      this.hideImgHandle();
    }

    // ------------------------------------------------------------ commands
    saveSel() {
      const s = getSelection();
      if (s.rangeCount && this.page.contains(s.anchorNode)) this.savedRange = s.getRangeAt(0).cloneRange();
    }
    restoreSel() {
      const s = getSelection();
      if (this.savedRange && !(s.rangeCount && this.page.contains(s.anchorNode))) {
        this.page.focus();
        s.removeAllRanges();
        s.addRange(this.savedRange);
      }
    }
    exec(command, value = null, css = false) {
      this.restoreSel();
      this.page.focus();
      document.execCommand('styleWithCSS', false, css);
      document.execCommand(command, false, value);
      document.execCommand('styleWithCSS', false, false);
      this.changed();
    }
    setFontSize(pt) {
      this.restoreSel();
      this.page.focus();
      document.execCommand('styleWithCSS', false, false);
      document.execCommand('fontSize', false, '7');
      const made = [];
      for (const f of this.page.querySelectorAll('font[size="7"]')) {
        const span = document.createElement('span');
        span.style.fontSize = pt + 'pt';
        while (f.firstChild) span.append(f.firstChild);
        f.replaceWith(span);
        // remove nested font-size spans so the new size wins
        span.querySelectorAll('span').forEach((s) => { s.style.fontSize = ''; if (!s.getAttribute('style')) s.replaceWith(...s.childNodes); });
        made.push(span);
      }
      if (made.length) { // keep the selection so the next command applies to the same text
        const r = document.createRange();
        r.setStartBefore(made[0]); r.setEndAfter(made[made.length - 1]);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        this.savedRange = r.cloneRange();
      }
      this.changed();
    }

    insertTable(rows, cols) {
      let html = '<table><tbody>';
      for (let r = 0; r < rows; r++) {
        html += '<tr>';
        for (let c = 0; c < cols; c++) html += r === 0 ? '<td><b><br></b></td>' : '<td><br></td>';
        html += '</tr>';
      }
      html += '</tbody></table><p><br></p>';
      this.exec('insertHTML', html);
    }
    async insertImage(dataUrl) {
      this.saveSel();
      const src = dataUrl || (await window.api.pickImage());
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > this.innerW()) { h = Math.round((h * this.innerW()) / w); w = this.innerW(); }
        this.exec('insertHTML', `<img src="${src}" width="${w}" height="${h}">`);
      };
      img.src = src;
    }
    async insertLink() {
      this.saveSel();
      const text = getSelection().toString();
      const r = await modal({ title: 'Вставить ссылку', fields: [{ name: 'url', label: 'Адрес', value: 'https://' }, ...(text ? [] : [{ name: 'text', label: 'Текст ссылки', value: '' }])], okText: 'Вставить' });
      if (!r || !r.url) return;
      if (text) this.exec('createLink', r.url);
      else this.exec('insertHTML', `<a href="${esc(r.url)}">${esc(r.text || r.url)}</a>`);
    }

    // ------------------------------------------------------------ table ops
    cellAt(node) {
      const n = node && (node.nodeType === 1 ? node : node.parentElement);
      const td = n && n.closest('td,th');
      return td && this.page.contains(td) ? td : null;
    }
    tableOp(td, op) {
      const tr = td.parentElement, table = td.closest('table');
      const idx = Array.from(tr.children).indexOf(td);
      const rows = Array.from(table.rows);
      const blankCell = () => { const c = document.createElement('td'); c.innerHTML = '<br>'; return c; };
      if (op === 'rowAbove' || op === 'rowBelow') {
        const nr = document.createElement('tr');
        for (let i = 0; i < tr.children.length; i++) nr.append(blankCell());
        op === 'rowAbove' ? tr.before(nr) : tr.after(nr);
      } else if (op === 'colLeft' || op === 'colRight') {
        for (const r of rows) {
          const ref = r.children[Math.min(idx, r.children.length - 1)];
          if (!ref) continue;
          op === 'colLeft' ? ref.before(blankCell()) : ref.after(blankCell());
        }
      } else if (op === 'delRow') {
        if (rows.length === 1) table.remove(); else tr.remove();
      } else if (op === 'delCol') {
        if (tr.children.length === 1) table.remove();
        else for (const r of rows) r.children[idx] && r.children[idx].remove();
      } else if (op === 'delTable') table.remove();
      else if (op === 'shade') {
        UI.colorPicker(td, { current: '#d9e2f3', allowNone: true, noneLabel: 'Без заливки', onPick: (c) => { td.style.backgroundColor = c || ''; this.changed(); } });
        return;
      }
      this.changed();
    }

    // ------------------------------------------------------------ image resizing
    selectImage(img) {
      this.page.querySelectorAll('img.sel').forEach((i) => i.classList.remove('sel'));
      this.selImg = img;
      if (!img) return this.hideImgHandle();
      img.classList.add('sel');
      this.showImgHandle();
    }
    showImgHandle() {
      if (!this.handle) {
        this.handle = el('div', { class: 'img-handle', title: 'Потяните, чтобы изменить размер' });
        this.handle.addEventListener('mousedown', (e) => this.startImgResize(e));
        this.scroll.append(this.handle);
      }
      const r = this.selImg.getBoundingClientRect(), s = this.scroll.getBoundingClientRect();
      this.handle.style.left = r.right - s.left + this.scroll.scrollLeft - 7 + 'px';
      this.handle.style.top = r.bottom - s.top + this.scroll.scrollTop - 7 + 'px';
      this.handle.style.display = '';
    }
    hideImgHandle() { if (this.handle) this.handle.style.display = 'none'; }
    startImgResize(e) {
      e.preventDefault();
      const img = this.selImg;
      const startX = e.clientX, w0 = img.getBoundingClientRect().width / this.zoom;
      const ratio = (img.naturalHeight || img.height) / (img.naturalWidth || img.width) || 1;
      const move = (ev) => {
        const w = Math.max(24, Math.min(this.innerW(), Math.round(w0 + (ev.clientX - startX) / this.zoom)));
        img.setAttribute('width', w);
        img.setAttribute('height', Math.round(w * ratio));
        img.style.width = ''; img.style.height = '';
        this.showImgHandle();
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.changed(); };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }

    // ------------------------------------------------------------ find & replace
    find() {
      if (this.findbar) { this.findInput.focus(); this.findInput.select(); return; }
      this.findInput = el('input', { type: 'text', placeholder: 'Найти' });
      this.replInput = el('input', { type: 'text', placeholder: 'Заменить на' });
      this.findCount = el('span', { class: 'cnt' });
      const close = btn({ icon: 'x', title: 'Закрыть', keepFocus: false, onClick: () => this.closeFind() });
      this.findbar = el('div', { class: 'findbar' }, [
        this.findInput, this.findCount,
        btn({ icon: 'up', title: 'Предыдущее', keepFocus: false, onClick: () => this.findStep(-1) }),
        btn({ icon: 'down', title: 'Следующее', keepFocus: false, onClick: () => this.findStep(1) }),
        this.replInput,
        btn({ label: 'Заменить', keepFocus: false, onClick: () => this.replaceOne() }),
        btn({ label: 'Все', title: 'Заменить все', keepFocus: false, onClick: () => this.replaceAll() }),
        close,
      ]);
      this.root.append(this.findbar);
      this.findInput.addEventListener('input', () => this.highlight());
      this.findInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.findStep(e.shiftKey ? -1 : 1); if (e.key === 'Escape') this.closeFind(); });
      this.replInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.replaceOne(); if (e.key === 'Escape') this.closeFind(); });
      const sel = getSelection().toString();
      if (sel && sel.length < 80) this.findInput.value = sel;
      this.findInput.focus();
      this.highlight();
    }
    clearMarks(root = this.page) {
      root.querySelectorAll('mark.find-hit').forEach((m) => { m.replaceWith(...m.childNodes); });
      root.normalize();
    }
    highlight() {
      this.clearMarks();
      this.hits = [];
      this.hitIdx = -1;
      const q = this.findInput.value;
      if (!q) { this.findCount.textContent = ''; return; }
      const ql = q.toLowerCase();
      const walker = document.createTreeWalker(this.page, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const n of nodes) {
        let text = n.nodeValue, idx, node = n;
        while ((idx = text.toLowerCase().indexOf(ql)) >= 0) {
          const hit = node.splitText(idx);
          const rest = hit.splitText(q.length);
          const m = document.createElement('mark');
          m.className = 'find-hit';
          hit.replaceWith(m);
          m.append(hit);
          this.hits.push(m);
          node = rest;
          text = rest.nodeValue;
        }
      }
      this.findCount.textContent = this.hits.length ? `${this.hits.length}` : 'нет';
      if (this.hits.length) this.findStep(1);
    }
    findStep(d) {
      if (!this.hits || !this.hits.length) return;
      if (this.hits[this.hitIdx]) this.hits[this.hitIdx].classList.remove('cur');
      this.hitIdx = (this.hitIdx + d + this.hits.length) % this.hits.length;
      const m = this.hits[this.hitIdx];
      m.classList.add('cur');
      m.scrollIntoView({ block: 'center' });
      this.findCount.textContent = `${this.hitIdx + 1} из ${this.hits.length}`;
    }
    replaceOne() {
      const m = this.hits && this.hits[this.hitIdx];
      if (!m) return;
      m.replaceWith(document.createTextNode(this.replInput.value));
      this.hits.splice(this.hitIdx, 1);
      this.hitIdx--;
      this.changed();
      if (this.hits.length) this.findStep(1); else this.findCount.textContent = 'нет';
    }
    replaceAll() {
      if (!this.hits || !this.hits.length) return;
      const n = this.hits.length;
      for (const m of this.hits) m.replaceWith(document.createTextNode(this.replInput.value));
      this.hits = [];
      this.page.normalize();
      this.findCount.textContent = 'нет';
      this.changed();
      toast(`Заменено: ${n}`);
    }
    closeFind() {
      this.clearMarks();
      this.findbar.remove();
      this.findbar = null;
      this.page.focus();
    }

    // ------------------------------------------------------------ paste sanitising
    sanitize(html) {
      const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
      doc.querySelectorAll('script,style,meta,link,title,xml,o\\:p,iframe,object,embed').forEach((n) => n.remove());
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
      const comments = [];
      while (walker.nextNode()) comments.push(walker.currentNode);
      comments.forEach((c) => c.remove());
      doc.body.querySelectorAll('*').forEach((n) => {
        for (const a of Array.from(n.attributes)) {
          const name = a.name.toLowerCase();
          if (name.startsWith('on') || name === 'contenteditable' && !n.classList.contains('page-break')) n.removeAttribute(a.name);
          else if (name === 'class' && !/page-break|os-ink/.test(a.value)) n.removeAttribute(a.name);
          else if (name === 'style') {
            const keep = a.value.split(';').map((s) => s.trim()).filter((s) => /^(color|background-color|font-size|font-family|font-weight|font-style|text-decoration|text-align|margin-left|margin-right|margin-top|margin-bottom|line-height|text-indent|width|height)\s*:/i.test(s) && !/mso-/i.test(s));
            keep.length ? n.setAttribute('style', keep.join(';')) : n.removeAttribute('style');
          } else if (name === 'href' && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
        }
      });
      doc.querySelectorAll('.page-break').forEach((p) => p.setAttribute('contenteditable', 'false'));
      return doc.body.innerHTML;
    }

    // ------------------------------------------------------------ events
    bind() {
      const p = this.page;
      p.addEventListener('input', () => { this.editSeq++; this.changed(); this.schedulePaginate(); });
      p.addEventListener('click', (e) => {
        const te = e.target.closest('.toc-e');
        if (te && this.tocTargets && this.tocTargets[+te.dataset.i]) this.tocTargets[+te.dataset.i].scrollIntoView({ block: 'start', behavior: 'smooth' });
      });
      this.sheets.addEventListener('dblclick', (e) => { if (e.target.closest('.doc-hf')) this.headerFooterDialog(); });
      p.addEventListener('paste', (e) => {
        const items = Array.from(e.clipboardData.items || []);
        const imgItem = items.find((i) => i.type.startsWith('image/'));
        const html = e.clipboardData.getData('text/html');
        if (imgItem && !html) {
          e.preventDefault();
          const fr = new FileReader();
          fr.onload = () => this.insertImage(fr.result);
          fr.readAsDataURL(imgItem.getAsFile());
          return;
        }
        if (html) {
          e.preventDefault();
          this.exec('insertHTML', this.sanitize(html));
        }
      });
      p.addEventListener('drop', (e) => {
        const f = Array.from(e.dataTransfer.files || []).find((x) => x.type.startsWith('image/'));
        if (!f) return;
        e.preventDefault();
        const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (pos) { const s = getSelection(); s.removeAllRanges(); s.addRange(pos); }
        const fr = new FileReader();
        fr.onload = () => this.insertImage(fr.result);
        fr.readAsDataURL(f);
      });
      p.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          const li = this.cellAt(getSelection().anchorNode) ? null : getSelection().anchorNode?.parentElement?.closest('li');
          const td = this.cellAt(getSelection().anchorNode);
          if (td && !e.shiftKey) {
            const cells = Array.from(td.closest('table').querySelectorAll('td,th'));
            const next = cells[cells.indexOf(td) + 1];
            if (next) { const r = document.createRange(); r.selectNodeContents(next); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); }
            else { this.tableOp(td, 'rowBelow'); this.page.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' })); }
          } else if (li) this.exec(e.shiftKey ? 'outdent' : 'indent');
          else if (!e.shiftKey) this.exec('insertText', ' ');
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selImg) {
          e.preventDefault();
          this.selImg.remove();
          this.selectImage(null);
          this.changed();
        }
      });
      p.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'IMG') { this.selectImage(e.target); }
        else if (this.selImg) this.selectImage(null);
      });
      p.addEventListener('dblclick', (e) => {
        if (e.target.tagName === 'A') window.open(e.target.href);
      });
      p.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const td = this.cellAt(e.target);
        const items = [
          { label: 'Вырезать', icon: 'x', key: 'Ctrl+X', onClick: () => document.execCommand('cut') },
          { label: 'Копировать', icon: 'copy', key: 'Ctrl+C', onClick: () => document.execCommand('copy') },
          { label: 'Вставить', icon: 'fileText', key: 'Ctrl+V', onClick: () => { this.page.focus(); document.execCommand('paste'); } },
        ];
        if (td) {
          items.push('-',
            { label: 'Вставить строку выше', icon: 'up', onClick: () => this.tableOp(td, 'rowAbove') },
            { label: 'Вставить строку ниже', icon: 'down', onClick: () => this.tableOp(td, 'rowBelow') },
            { label: 'Вставить столбец слева', icon: 'outdent', onClick: () => this.tableOp(td, 'colLeft') },
            { label: 'Вставить столбец справа', icon: 'indent', onClick: () => this.tableOp(td, 'colRight') },
            { label: 'Заливка ячейки…', icon: 'paint', onClick: () => this.tableOp(td, 'shade') },
            '-',
            { label: 'Удалить строку', icon: 'trash', onClick: () => this.tableOp(td, 'delRow') },
            { label: 'Удалить столбец', icon: 'trash', onClick: () => this.tableOp(td, 'delCol') },
            { label: 'Удалить таблицу', icon: 'trash', onClick: () => this.tableOp(td, 'delTable') });
        }
        if (e.target.tagName === 'IMG') {
          const img = e.target;
          items.push('-',
            { label: 'Исходный размер', icon: 'image', onClick: () => { const w = Math.min(this.innerW(), img.naturalWidth); img.setAttribute('width', w); img.setAttribute('height', Math.round((w * img.naturalHeight) / img.naturalWidth)); this.selectImage(img); this.changed(); } },
            { label: 'По ширине страницы', icon: 'fit', onClick: () => { img.setAttribute('width', this.innerW()); img.setAttribute('height', Math.round((this.innerW() * img.naturalHeight) / img.naturalWidth)); this.selectImage(img); this.changed(); } },
            { label: 'Удалить рисунок', icon: 'trash', onClick: () => { img.remove(); this.selectImage(null); this.changed(); } });
        }
        UI.menu(e.clientX, e.clientY, items);
      });
      this.onSelChange = () => {
        const s = getSelection();
        if (!s.rangeCount || !this.page.contains(s.anchorNode)) return;
        this.saveSel();
        this.updateState();
        this.ruler.update();
      };
      document.addEventListener('selectionchange', this.onSelChange);
      this.scroll.addEventListener('scroll', () => this.selImg && this.showImgHandle());
      this.scroll.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); this.setZoom(this.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });
    }

    updateState() {
      for (const [c, b] of Object.entries(this.stateBtns)) {
        let on = false;
        try { on = document.queryCommandState(c); } catch {}
        b.classList.toggle('on', on);
      }
      const s = getSelection();
      const node = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
      if (!node) return;
      const cs = getComputedStyle(node);
      const pt = Math.round((parseFloat(cs.fontSize) * 72) / 96 * 2) / 2;
      if (document.activeElement !== this.sizeSel) {
        if (![...this.sizeSel.options].some((o) => +o.value === pt)) this.sizeSel.append(el('option', { value: String(pt), text: String(pt) }));
        this.sizeSel.value = String(pt);
      }
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (document.activeElement !== this.fontSel) {
        if (![...this.fontSel.options].some((o) => o.value === fam)) this.fontSel.append(el('option', { value: fam, text: fam }));
        this.fontSel.value = fam;
      }
      const block = node.closest('h1,h2,h3,h4,h5,h6,blockquote,p,li,td');
      const tag = block ? block.tagName.toLowerCase() : 'p';
      this.styleSel.value = ['h1', 'h2', 'h3', 'blockquote'].includes(tag) ? tag : 'p';
    }

    changed() {
      this.onDirty();
      clearTimeout(this.countTimer);
      this.countTimer = setTimeout(() => this.updateCounts(), 300);
      if (this.selImg) this.showImgHandle();
    }
    updateCounts() {
      const text = this.page.innerText || '';
      const words = (text.match(/[\p{L}\p{N}]+/gu) || []).length;
      this.countEl.textContent = `Слов: ${words.toLocaleString('ru')}  ·  Знаков: ${text.replace(/\s/g, '').length.toLocaleString('ru')}`;
    }

    // ------------------------------------------------------------ editor API
    getData() {
      const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th';
      const blocks = Array.from(this.page.querySelectorAll(BLOCK)).filter((b) => !b.querySelector(BLOCK));
      blocks.forEach((b, i) => b.setAttribute('data-osb', i));
      const clone = this.page.cloneNode(true);
      const inline = this.page.cloneNode(true);
      const geo = this.inks.length ? blocks.map((b) => this.blockGeo(b)) : [];
      blocks.forEach((b) => b.removeAttribute('data-osb'));
      const inks = [];
      this.inks.forEach((st, i) => {
        if (!blocks.length) return;
        const b = Ink.bbox(st.pts);
        let idx = 0;
        geo.forEach((g, k) => { if (g.top <= b.y1) idx = k; });
        const g = geo[idx];
        const png = Ink.strokePng(st.pts, st.color, st.width);
        const token = `OSINKTOKEN${i}X`;
        const meta = { x: png.x, dy: png.y - g.top, color: st.color, width: st.width, pts: st.pts.map(([x, y]) => [+(x - png.x).toFixed(2), +(y - png.y).toFixed(2)]) };
        const cb = clone.querySelector(`[data-osb="${idx}"]`);
        cb.insertBefore(document.createTextNode(token), cb.firstChild);
        inks.push({ token, png: png.dataUrl, xMargin: png.x - this.geom.ml, dy: png.y - g.top, w: png.w, h: png.h, meta: JSON.stringify(meta) });
        // inline SVG version for PDF / HTML
        const ib = inline.querySelector(`[data-osb="${idx}"]`);
        const svg = `<span style="position:relative;display:inline-block;width:0;height:0;vertical-align:top"><svg xmlns="http://www.w3.org/2000/svg" width="${png.w}" height="${png.h}" style="position:absolute;left:${png.x - g.left}px;top:${png.y - g.top}px;overflow:visible;pointer-events:none"><path d="${Ink.pathD(meta.pts)}" fill="none" stroke="${st.color}" stroke-width="${st.width}" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
        ib.insertAdjacentHTML('afterbegin', svg);
      });
      for (const c of [clone, inline]) {
        c.querySelectorAll('[data-osb]').forEach((n) => n.removeAttribute('data-osb'));
        this.clearMarks(c);
        c.querySelectorAll('img.sel').forEach((i) => i.classList.remove('sel'));
        c.querySelectorAll('[class=""]').forEach((n) => n.removeAttribute('class'));
      }
      return { html: clone.innerHTML, inks, htmlInline: inline.innerHTML };
    }

    // ------------------------------------------------------------ red pencil
    blockGeo(b) {
      const pr = this.page.getBoundingClientRect(), r = b.getBoundingClientRect();
      const f = pr.width / this.geom.W || 1;
      return { top: (r.top - pr.top) / f, left: (r.left - pr.left) / f };
    }
    toPage(ev) {
      const r = this.page.getBoundingClientRect();
      const f = r.width / this.geom.W || 1;
      return [(ev.clientX - r.left) / f, (ev.clientY - r.top) / f];
    }
    renderInk(live) {
      this.inkLayer.setAttribute('width', this.geom.W);
      this.inkLayer.setAttribute('height', this.page.offsetHeight);
      const paths = this.inks.map((st) => `<path d="${Ink.pathD(st.pts)}" stroke="${st.color}" stroke-width="${st.width}"/>`);
      if (live) paths.push(`<path d="${Ink.pathD(live)}" stroke="${Ink.COLOR}" stroke-width="3"/>`);
      this.inkLayer.innerHTML = paths.join('');
    }
    setInkMode(m) {
      this.inkMode = m;
      this.inkLayer.classList.toggle('active', m === 'pencil');
      this.inkLayer.classList.toggle('erasing', m === 'eraser');
      this.penBtn.classList.toggle('ink-on', m === 'pencil');
      this.eraserBtn.classList.toggle('ink-on', m === 'eraser');
      this.renderInk();
      if (m) toast(m === 'pencil' ? 'Карандаш: рисуйте мышью поверх документа. Esc — выход' : 'Ластик: проведите по пометкам. Esc — выход', null, 2500);
    }
    pushInkUndo() { this.inkUndo.push(this.inks.slice()); if (this.inkUndo.length > 100) this.inkUndo.shift(); }
    clearInk() {
      if (!this.inks.length) { toast('Пометок нет'); return; }
      const n = this.inks.length;
      this.pushInkUndo();
      this.inks = [];
      this.renderInk();
      this.onDirty();
      toast(`Удалено пометок: ${n}. Отменить — Ctrl+Z в режиме карандаша`);
    }
    bindInk() {
      this.inkLayer.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        if (this.inkMode === 'pencil') {
          Ink.capture(ev, (e) => this.toPage(e), (pts) => this.renderInk(pts), (pts) => {
            let sp = Ink.simplify(pts, 0.6);
            if (sp.length === 1) sp = [sp[0], [sp[0][0] + 0.5, sp[0][1]]];
            this.pushInkUndo();
            this.inks.push({ color: Ink.COLOR, width: 3, pts: sp });
            this.renderInk();
            this.onDirty();
          });
        } else if (this.inkMode === 'eraser') {
          const before = this.inks.slice();
          const at = (e) => {
            const p = this.toPage(e);
            const n = this.inks.length;
            this.inks = this.inks.filter((st) => Ink.distToPolyline(p, st.pts) > 8);
            if (this.inks.length !== n) this.renderInk();
          };
          at(ev);
          const move = (e) => at(e);
          const up = () => {
            removeEventListener('mousemove', move); removeEventListener('mouseup', up);
            if (this.inks.length !== before.length) { this.inkUndo.push(before); this.onDirty(); }
          };
          addEventListener('mousemove', move);
          addEventListener('mouseup', up);
        }
      });
      this.root.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.inkMode) { e.preventDefault(); this.setInkMode(null); }
      });
      this.inkRO = new ResizeObserver(() => this.renderInk());
      this.inkRO.observe(this.page);
    }
    // strokes stored in a DOCX come back as <span class="os-ink" data-ink="..."> markers
    loadInkMarkers() {
      const marks = Array.from(this.page.querySelectorAll('span.os-ink'));
      for (const m of marks) {
        try {
          const meta = JSON.parse(m.getAttribute('data-ink'));
          const block = m.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th') || m.parentElement;
          const g = this.blockGeo(block);
          const oy = g.top + meta.dy;
          this.inks.push({ color: meta.color || Ink.COLOR, width: meta.width || 3, pts: meta.pts.map(([x, y]) => [x + meta.x, y + oy]) });
        } catch {}
        m.remove();
      }
      this.renderInk();
    }

    undo() {
      if (this.inkMode && this.inkUndo.length) { this.inks = this.inkUndo.pop(); this.renderInk(); this.onDirty(); return; }
      // paragraph geometry changes (ruler, «Абзац») live in our own stack, ordered against typing
      const last = this.paraUndo[this.paraUndo.length - 1];
      if (last && last.seq >= this.editSeq) {
        this.paraUndo.pop();
        last.els.forEach((e, i) => setStyleAttr(e, last.before[i]));
        this.paraRedo.push(last);
        this.changed(); this.ruler.update();
        return;
      }
      this.page.focus(); document.execCommand('undo'); this.changed(); this.ruler.update();
    }
    redo() {
      const next = this.paraRedo[this.paraRedo.length - 1];
      if (next && next.seq >= this.editSeq) {
        this.paraRedo.pop();
        next.els.forEach((e, i) => setStyleAttr(e, next.after[i]));
        this.paraUndo.push(next);
        this.changed(); this.ruler.update();
        return;
      }
      this.page.focus(); document.execCommand('redo'); this.changed(); this.ruler.update();
    }

    // ------------------------------------------------------------ paragraph geometry (ruler)
    /** block elements touched by the selection (innermost paragraphs) */
    selectedBlocks() {
      const s = getSelection();
      let range = s.rangeCount && this.page.contains(s.anchorNode) ? s.getRangeAt(0) : this.savedRange;
      if (!range) return [];
      const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,div:not(.page-break)';
      const own = (n) => { const e = n.nodeType === 1 ? n : n.parentElement; const b = e && e.closest(BLOCK); return b && this.page.contains(b) && b !== this.page ? b : null; };
      const out = [];
      const a = own(range.startContainer);
      if (range.collapsed) return a ? [a] : [];
      const all = Array.from(this.page.querySelectorAll(BLOCK)).filter((b) => !b.querySelector('p,h1,h2,h3,h4,h5,h6,li'));
      for (const b of all) if (range.intersectsNode(b)) out.push(b);
      if (!out.length && a) out.push(a);
      return out;
    }
    /** geometry of a block in page px (independent of zoom): left/right edges and first line */
    blockIndents(b) {
      const pr = this.page.getBoundingClientRect(), br = b.getBoundingClientRect();
      const z = this.zoom;
      const cs = getComputedStyle(b);
      const left = (br.left - pr.left) / z - this.geom.ml;
      const right = (pr.right - br.right) / z - this.geom.mr;
      const ti = parseFloat(cs.textIndent) || 0;
      return { left, right, first: left + ti, ti };
    }
    /** applies fn(block) to the selected paragraphs as one undoable step */
    editParagraphs(fn, blocks) {
      blocks = blocks || this.selectedBlocks();
      if (!blocks.length) return false;
      const before = blocks.map((b) => b.getAttribute('style'));
      blocks.forEach(fn);
      const after = blocks.map((b) => b.getAttribute('style'));
      if (before.every((v, i) => v === after[i])) return false;
      this.paraUndo.push({ els: blocks, before, after, seq: this.editSeq });
      this.paraRedo = [];
      this.changed();
      this.ruler.update();
      return true;
    }
    stepIndent(dir) {
      const blocks = this.selectedBlocks();
      if (blocks.some((b) => b.tagName === 'LI')) { this.exec(dir > 0 ? 'indent' : 'outdent'); return; }
      const step = CM * 1.25;
      this.editParagraphs((b) => {
        const cur = parseFloat(b.style.marginLeft) || 0;
        const v = Math.max(0, Math.round((Math.round(cur / step) + dir) * step));
        b.style.marginLeft = v ? v + 'px' : '';
      }, blocks);
    }
    async paragraphDialog() {
      const blocks = this.selectedBlocks();
      if (!blocks.length) { toast('Поставьте курсор в абзац'); return; }
      const b = blocks[0];
      const cs = getComputedStyle(b);
      const cm = (px) => +(px / CM).toFixed(2);
      const ti = parseFloat(b.style.textIndent) || 0;
      const pt = (px) => +(px * 0.75).toFixed(1);
      const lh = b.style.lineHeight;
      const r = await modal({
        title: 'Абзац',
        fields: [
          { name: 'left', label: 'Отступ слева, см', type: 'number', value: cm(parseFloat(b.style.marginLeft) || 0), min: -5, max: 15 },
          { name: 'right', label: 'Отступ справа, см', type: 'number', value: cm(parseFloat(b.style.marginRight) || 0), min: -5, max: 15 },
          { name: 'first', label: 'Первая строка', type: 'select', options: [['none', 'Нет'], ['indent', 'Отступ (красная строка)'], ['hang', 'Выступ']], value: ti > 0 ? 'indent' : ti < 0 ? 'hang' : 'none' },
          { name: 'by', label: 'на, см', type: 'number', value: ti ? cm(Math.abs(ti)) : 1.25, min: 0, max: 10 },
          { name: 'before', label: 'Интервал перед, пт', type: 'number', value: pt(parseFloat(cs.marginTop) || 0), min: 0, max: 200 },
          { name: 'after', label: 'Интервал после, пт', type: 'number', value: pt(parseFloat(cs.marginBottom) || 0), min: 0, max: 200 },
          { name: 'line', label: 'Междустрочный интервал', type: 'select', options: [['', 'Как в стиле'], ['1', 'Одинарный'], ['1.15', '1,15'], ['1.5', 'Полуторный'], ['2', 'Двойной'], ['2.5', '2,5'], ['3', 'Тройной']], value: lh && /^[\d.]+$/.test(lh) ? String(+lh) : '' },
        ],
        okText: 'Применить',
      });
      if (!r) return;
      const px = (v) => (isFinite(v) && v ? Math.round(v * CM) + 'px' : '');
      this.editParagraphs((el2) => {
        el2.style.marginLeft = px(r.left);
        el2.style.marginRight = px(r.right);
        el2.style.textIndent = r.first === 'none' || !r.by ? '' : (r.first === 'hang' ? '-' : '') + Math.round(r.by * CM) + 'px';
        el2.style.marginTop = isFinite(r.before) ? r.before + 'pt' : '';
        el2.style.marginBottom = isFinite(r.after) ? r.after + 'pt' : '';
        el2.style.lineHeight = r.line || '';
      }, blocks);
    }
    async exportMenu() {
      const busy = toast('Готовлю PDF…');
      const r = await window.api.exportPdf({ html: this.getData().htmlInline, suggestedName: this.tabName() });
      if (r.ok) toast('PDF сохранён: ' + r.path.split(/[\\/]/).pop());
      else if (!r.canceled) toast('Ошибка экспорта: ' + r.error, 'error');
    }
    tabName() { return (window.App && window.App.active() && window.App.active().name) || 'Документ'; }
    onActivate() { setTimeout(() => this.page.focus(), 0); }
    onActivate() { requestAnimationFrame(() => this.ruler.update()); }
    destroy() { this.ruler.destroy(); document.removeEventListener('selectionchange', this.onSelChange); if (this.inkRO) this.inkRO.disconnect(); }
  }

  window.DocEditor = DocEditor;
})();
