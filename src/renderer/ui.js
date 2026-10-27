/* Shared UI helpers: icons, toolbar builders, popups, modals, toasts */
(function () {
  const P = {
    undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
    redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
    bold: 'M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z',
    italic: 'M19 4h-9M14 20H5M15 4 9 20',
    underline: 'M6 4v6a6 6 0 0 0 12 0V4M4 20h16',
    strike: 'M16 6c-.6-1.4-2.2-2-4-2-2.5 0-4 1.3-4 3 0 1 .5 1.8 1.4 2.3M4 12h16M8.5 17c.6 1.6 2 3 4 3 2.5 0 4-1.4 4-3.2 0-.8-.3-1.4-.8-1.8',
    sup: 'm4 19 8-8m0 8-8-8M20 12h-4c0-1.5.4-2 1.5-2.6 1.1-.6 2.5-1.3 2.5-2.7 0-1-.8-1.7-2-1.7s-2 .7-2 1.6',
    sub: 'm4 5 8 8m0-8-8 8M20 19h-4c0-1.5.4-2 1.5-2.6 1.1-.6 2.5-1.3 2.5-2.7 0-1-.8-1.7-2-1.7s-2 .7-2 1.6',
    textColor: 'M5 16 10.5 3h3L19 16M7.5 11h9',
    highlight: 'm9 11-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
    alignLeft: 'M3 6h18M3 12h12M3 18h16',
    alignCenter: 'M3 6h18M6 12h12M4 18h16',
    alignRight: 'M3 6h18M9 12h12M5 18h16',
    alignJustify: 'M3 6h18M3 12h18M3 18h18',
    listUl: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
    listOl: 'M10 6h11M10 12h11M10 18h11M4 4v4M3 8h2M3 14c0-1 .7-1.5 1.5-1.5S6 13 6 13.6c0 1.1-3 1.9-3 3.4h3M3 20.5',
    indent: 'M3 6h18M11 12h10M11 18h10M3 10l3 2-3 2',
    outdent: 'M3 6h18M11 12h10M11 18h10M6 10l-3 2 3 2',
    table: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 9h18M3 15h18M9 3v18M15 3v18',
    image: 'M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3M20 15l-5-5L6 21',
    link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
    hr: 'M3 12h18M7 8h10M7 16h10',
    pageBreak: 'M5 3v5h14V3M5 21v-5h14v5M3 12h2M8 12h2M13 12h2M18 12h2',
    pencil: 'M17 3a2.85 2.85 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5zM15 5l4 4',
    inkClear: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M9 14c1-2 2-2 3 0s2 2 3 0',
    eraser: 'm7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L13 19M22 21H7M5 11l9 9',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M21 21l-4.3-4.3',
    text: 'M4 7V4h16v3M9 20h6M12 4v16',
    rect: 'M4 5h16v14H4z',
    ellipse: 'M12 19c4.4 0 8-3.1 8-7s-3.6-7-8-7-8 3.1-8 7 3.6 7 8 7',
    triangle: 'M12 4 21 20H3z',
    line: 'M5 19 19 5',
    arrow: 'M4 12h14M13 6l6 6-6 6',
    star: 'm12 3 2.8 5.6 6.2.9-4.5 4.4 1 6.1-5.5-2.9L6.5 20l1-6.1L3 9.5l6.2-.9z',
    diamond: 'M12 3 21 12 12 21 3 12z',
    shapes: 'M8.3 10a.7.7 0 0 1-.6-1L11.4 3a.7.7 0 0 1 1.2 0L16.3 9a.7.7 0 0 1-.6 1zM3 14h7v7H3zM17.5 21a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    front: 'M8 8h12v12H8zM4 16V4h12',
    back: 'M4 4h12v12H4zM20 8v12H8',
    trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    play: 'm7 4 13 8-13 8z',
    plus: 'M12 5v14M5 12h14',
    cursor: 'm4 4 7 17 2.5-7.5L21 11z',
    polyline: 'M3 17l5-8 5 5 4-9 4 3',
    circle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 12h.01',
    arc: 'M4 18A10 10 0 0 1 20 10',
    move: 'M12 2v20M2 12h20M12 2l-3 3m3-3 3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3M22 12l-3-3m3 3-3 3',
    rotate: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
    grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
    magnet: 'm6 15-4-4 6.8-6.8a5.7 5.7 0 0 1 8 8L10 19l-4-4M5 8l4 4M12 15l4 4',
    ortho: 'M4 4v16h16',
    snap: 'M5 5h6v6H5zM14 14l7 7M14 14h4M14 14v4',
    eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    eyeOff: 'M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.5M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2',
    fit: 'M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8',
    download: 'M12 3v12M7 10l5 5 5-5M5 21h14',
    save: 'M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2M7 3v6h8M7 21v-7h10v7',
    folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    fileText: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h8M8 9h2',
    presentation: 'M3 4h18M4 4v11h16V4M12 15v4M8 21l4-2 4 2',
    ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
    paint: 'M19 11 11 3 3 11l8 8zM5 13h13M21 15s-2 2.2-2 3.5a2 2 0 0 0 4 0C23 17.2 21 15 21 15',
    border: 'M3 3h18v18H3z',
    vTop: 'M4 4h16M12 8v12M8 12l4-4 4 4',
    vMid: 'M4 12h16M12 3v5M12 16v5M9 6l3 2 3-2M9 18l3-2 3 2',
    vBot: 'M4 20h16M12 4v12M8 12l4 4 4-4',
    dup: 'M8 8h12v12H8zM16 8V4H4v12h4M14 11v6M11 14h6',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M18 13l-6 6-6-6',
    x: 'M18 6 6 18M6 6l12 12',
    layers: 'm12 3 9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5',
    measure: 'M3 7v10M21 7v10M3 12h18M7 9l-4 3 4 3M17 9l4 3-4 3',
    rectTool: 'M4 6h16v12H4zM4 6h.01M20 18h.01',
    chevDown: 'm6 9 6 6 6-6',
    keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
    pdf: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M9 15h1.5a1.5 1.5 0 0 0 0-3H9v6',
    slideLayout: 'M3 5h18v14H3zM7 9h10M7 13h6',
    mirror: 'M12 3v18M8 7 3 12l5 5zM16 7l5 5-5 5z',
  };

  function icon(name, size) {
    const d = P[name] || P.plus;
    return `<svg viewBox="0 0 24 24" ${size ? `width="${size}" height="${size}"` : ''} fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  }

  function el(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c != null) e.append(c);
    return e;
  }

  // toolbar button: keeps editor focus by preventing mousedown default
  function btn({ icon: ic, label, title, onClick, cls, keepFocus = true }) {
    const b = el('button', { class: 'tb-btn' + (cls ? ' ' + cls : '') + (label && !ic ? ' wide' : ''), title: title || label || '', html: (ic ? icon(ic) : '') + (label ? `<span class="lbl">${label}</span>` : '') });
    if (keepFocus) b.addEventListener('mousedown', (e) => e.preventDefault());
    if (onClick) b.addEventListener('click', (e) => onClick(e, b));
    return b;
  }
  const group = (...items) => el('div', { class: 'tb-group' }, items);

  function select(options, { title, onChange, width, cls } = {}) {
    const s = el('select', { class: 'tb-select' + (cls ? ' ' + cls : ''), title: title || '' });
    if (width) s.style.width = width + 'px';
    for (const o of options) {
      const [value, text] = Array.isArray(o) ? o : [o, o];
      s.append(el('option', { value, text }));
    }
    if (onChange) s.addEventListener('change', () => onChange(s.value, s));
    return s;
  }

  // ---------------------------------------------------------------- popups
  let openPopup = null;
  function closePopup() { if (openPopup) { openPopup.remove(); openPopup = null; } }
  document.addEventListener('mousedown', (e) => { if (openPopup && !openPopup.contains(e.target)) closePopup(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPopup) { closePopup(); e.stopPropagation(); } }, true);
  window.addEventListener('blur', closePopup);

  function popupAt(content, x, y) {
    closePopup();
    const p = el('div', { class: 'popup' }, content);
    p.addEventListener('mousedown', (e) => { if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) e.preventDefault(); });
    document.body.append(p);
    const r = p.getBoundingClientRect();
    p.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 6)) + 'px';
    p.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 6)) + 'px';
    openPopup = p;
    return p;
  }
  function popupBelow(anchor, content) {
    const r = anchor.getBoundingClientRect();
    return popupAt(content, r.left, r.bottom + 4);
  }

  function menu(x, y, items) {
    const box = el('div');
    for (const it of items) {
      if (it === '-') { box.append(el('div', { class: 'menu-sep' })); continue; }
      const row = el('div', { class: 'menu-item' + (it.disabled ? ' disabled' : ''), html: (it.icon ? icon(it.icon) : '<span style="width:16px"></span>') + `<span>${it.label}</span>` + (it.key ? `<span class="key">${it.key}</span>` : '') });
      row.addEventListener('click', () => { closePopup(); it.onClick && it.onClick(); });
      box.append(row);
    }
    return popupAt(box, x, y);
  }

  const PALETTE = [
    '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
    '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
    '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
    '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
    '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
    '#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130',
  ];
  function colorPicker(anchor, { current, onPick, allowNone, noneLabel }) {
    const pal = el('div', { class: 'palette' });
    for (const c of PALETTE) {
      const sw = el('div', { class: 'sw', title: c, style: { background: c } });
      sw.addEventListener('click', () => { closePopup(); onPick(c); });
      pal.append(sw);
    }
    const custom = el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#000000', title: 'Другой цвет' });
    custom.addEventListener('change', () => { closePopup(); onPick(custom.value); });
    const row = el('div', { class: 'palette-row' }, [el('span', { text: 'Другой:', style: { fontSize: '12px', color: 'var(--muted)' } }), custom]);
    if (allowNone) {
      const none = el('button', { text: noneLabel || 'Нет' });
      none.addEventListener('click', () => { closePopup(); onPick(null); });
      row.append(el('span', { style: { flex: 1 } }), none);
    }
    return popupBelow(anchor, [pal, row]);
  }

  function colorButton({ icon: ic, title, get, onPick, allowNone, fill, noneLabel }) {
    const b = btn({ icon: ic, title, cls: 'color-btn' + (fill ? ' fill' : '') });
    const sw = el('span', { class: 'swatch' });
    b.append(sw);
    const sync = () => {
      const c = get();
      sw.style.background = c || 'transparent';
      sw.style.border = c ? '0' : '1px dashed #999';
    };
    b.addEventListener('click', () => colorPicker(b, { current: get(), allowNone, noneLabel, onPick: (c) => { onPick(c); sync(); } }));
    b.sync = sync;
    sync();
    return b;
  }

  function gridPicker(anchor, onPick) {
    const g = el('div', { class: 'grid-picker' });
    const label = el('div', { class: 'grid-label', text: 'Вставить таблицу' });
    const cells = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 10; c++) {
      const d = el('div');
      d.addEventListener('mouseenter', () => {
        cells.forEach((x) => x.d.classList.toggle('on', x.r <= r && x.c <= c));
        label.textContent = `${c + 1} × ${r + 1}`;
      });
      d.addEventListener('click', () => { closePopup(); onPick(r + 1, c + 1); });
      cells.push({ d, r, c });
      g.append(d);
    }
    return popupBelow(anchor, [g, label]);
  }

  // ---------------------------------------------------------------- modal
  function modal({ title, fields = [], okText = 'OK', cancelText = 'Отмена', body }) {
    return new Promise((resolve) => {
      const back = el('div', { class: 'modal-back' });
      const form = el('form', { class: 'modal' });
      form.append(el('h3', { text: title }));
      const inputs = {};
      for (const f of fields) {
        let input;
        if (f.type === 'select') {
          input = el('select');
          for (const o of f.options) { const [v, t] = Array.isArray(o) ? o : [o, o]; input.append(el('option', { value: v, text: t })); }
          input.value = f.value ?? '';
        } else if (f.type === 'textarea') {
          input = el('textarea');
          input.value = f.value ?? '';
        } else {
          input = el('input', { type: f.type || 'text', step: f.step || 'any', min: f.min, max: f.max, placeholder: f.placeholder || '' });
          input.value = f.value ?? '';
        }
        inputs[f.name] = input;
        form.append(el('div', { class: 'field' }, [el('label', { text: f.label }), input]));
      }
      if (body) form.append(body);
      const done = (v) => { back.remove(); resolve(v); };
      const actions = el('div', { class: 'actions' });
      if (cancelText) actions.append(el('button', { type: 'button', text: cancelText, onclick: () => done(null) }));
      actions.append(el('button', { type: 'submit', class: 'primary', text: okText }));
      form.append(actions);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const out = {};
        for (const f of fields) out[f.name] = f.type === 'number' ? parseFloat(inputs[f.name].value) : inputs[f.name].value;
        done(out);
      });
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
      form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
      back.append(form);
      document.body.append(back);
      const first = form.querySelector('input,select,textarea') || form.querySelector('button.primary');
      setTimeout(() => { first.focus(); first.select && first.select(); }, 0);
    });
  }

  function toast(msg, type, ms = 3200) {
    const t = el('div', { class: 'toast' + (type ? ' ' + type : ''), text: msg });
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function rgbToHex(c) {
    if (!c) return null;
    if (c[0] === '#') return c.length === 4 ? '#' + c.slice(1).split('').map((x) => x + x).join('') : c.toLowerCase();
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c);
    if (!m) return null;
    if (m[4] !== undefined && +m[4] === 0) return null;
    return '#' + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, '0')).join('');
  }

  window.UI = { icon, el, btn, group, select, popupAt, popupBelow, closePopup, menu, colorPicker, colorButton, gridPicker, modal, toast, esc, rgbToHex, PALETTE };
})();
