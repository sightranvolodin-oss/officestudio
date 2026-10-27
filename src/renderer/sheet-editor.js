/* Excel-like spreadsheet editor. Values and formulas live in HyperFormula; styles, sizes, merges in `meta`. */
(function () {
  const { el, btn, group, select, colorButton, toast, modal, icon } = UI;
  const HDR_W = 46, HDR_H = 22, DEF_W = 72, DEF_H = 21;
  const FONT_FAMILY = "Calibri, Carlito, 'Segoe UI', Arial, sans-serif";
  const FONTS = ['Calibri', 'Arial', 'Times New Roman', 'Cambria', 'Segoe UI', 'Verdana', 'Tahoma', 'Courier New', 'Georgia'];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
  const GRID = '#e1e4e8', HDR_BG = '#f4f5f7', HDR_SEL = '#d3e6da', ACC = '#1d6f42';
  const ERR_RU = { DIV_BY_ZERO: '#ДЕЛ/0!', NA: '#Н/Д', NAME: '#ИМЯ?', NUM: '#ЧИСЛО!', REF: '#ССЫЛКА!', VALUE: '#ЗНАЧ!', CYCLE: '#ЦИКЛ!', ERROR: '#ОШИБКА!', SPILL: '#ПЕРЕНОС!', LIC: '#ЛИЦ!' };
  const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const MONTHS_G = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
  const EPOCH = Date.UTC(1899, 11, 30);

  const colName = (c) => { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = Math.floor((c - 1) / 26); } return s; };
  const colIndex = (s) => s.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const addr = (r, c) => colName(c) + (r + 1);
  const key = (r, c) => r + ':' + c;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // Russian function names -> English (as stored in .xlsx)
  let RU2EN = null;
  function ruMap() {
    if (RU2EN) return RU2EN;
    RU2EN = {};
    const L = window.HyperFormula && HyperFormula.languages && HyperFormula.languages.ruRU;
    if (L) for (const [en, ru] of Object.entries(L.functions)) RU2EN[ru.toUpperCase()] = en;
    return RU2EN;
  }
  /** accepts =СУММ(A1;A2) as well as =SUM(A1,A2); returns the English, comma-separated form */
  function normalizeFormula(f) {
    const map = ruMap();
    const russianSep = /;/.test(f.replace(/"[^"]*"/g, ''));
    let out = '', i = 0;
    while (i < f.length) {
      const ch = f[i];
      if (ch === '"') { const j = f.indexOf('"', i + 1); const end = j < 0 ? f.length : j + 1; out += f.slice(i, end); i = end; continue; }
      if (ch === "'") { const j = f.indexOf("'", i + 1); const end = j < 0 ? f.length : j + 1; out += f.slice(i, end); i = end; continue; }
      const m = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_.]*/.exec(f.slice(i));
      if (m && !/[A-Za-z0-9_$]/.test(f[i - 1] || '')) {
        const id = m[0], up = id.toUpperCase(), next = f[i + id.length];
        if (next === '(') out += map[up] || up;
        else if (next === '!') out += /[^\x00-\x7f]/.test(id) ? `'${id}'` : id; // Склад!B2 -> 'Склад'!B2
        else if (up === 'TRUE' || up === 'ИСТИНА') out += 'TRUE()';
        else if (up === 'FALSE' || up === 'ЛОЖЬ') out += 'FALSE()';
        else out += id;
        i += id.length;
        continue;
      }
      if (m) { out += m[0]; i += m[0].length; continue; }
      if (russianSep && ch === ';') { out += ','; i++; continue; }
      if (russianSep && ch === ',' && /\d/.test(f[i - 1] || '') && /\d/.test(f[i + 1] || '')) { out += '.'; i++; continue; }
      out += ch; i++;
    }
    return out;
  }

  // ------------------------------------------------------------ number formatting (Excel codes, Russian locale)
  const nf = (dec, group) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: group });
  const nfCache = new Map();
  const fmtNum = (v, dec, group) => { const k = dec + ':' + group; if (!nfCache.has(k)) nfCache.set(k, nf(dec, group)); return nfCache.get(k).format(v).replace(/ | /g, ' '); };
  function general(v) {
    if (!isFinite(v)) return String(v);
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e11 || a < 1e-9)) return v.toExponential(5).replace('.', ',').replace(/0+e/, 'e').replace(/,e/, 'e').replace('e', 'E');
    let s = String(+v.toPrecision(11));
    if (/e/.test(s)) s = v.toFixed(10).replace(/0+$/, '').replace(/\.$/, '');
    return s.replace('.', ',');
  }
  const fmtCache = new Map();
  function parseFmt(fmt) {
    if (fmtCache.has(fmt)) return fmtCache.get(fmt);
    const sections = [];
    let cur = '', q = false;
    for (let i = 0; i < fmt.length; i++) {
      const ch = fmt[i];
      if (ch === '"') q = !q;
      if (ch === ';' && !q) { sections.push(cur); cur = ''; continue; }
      cur += ch;
    }
    sections.push(cur);
    const parsed = sections.map((sec) => {
      // strip colours / locale codes, keep currency symbols from [$₽-419]
      let s = sec.replace(/\[(\$([^\]-]*)[^\]]*)\]/g, (m, a, sym) => (sym ? `"${sym}"` : '')).replace(/\[[^\]]*\]/g, '');
      const stripped = s.replace(/"[^"]*"/g, '').replace(/\\./g, '');
      const isDate = /[dyhs]/i.test(stripped) || (/m/i.test(stripped) && !/[0#?]/.test(stripped));
      const isText = stripped.includes('@');
      const percent = stripped.includes('%');
      const m = /([#0?, ]*)(\.([0#?]*))?/.exec(stripped.slice(stripped.search(/[#0?]/) >= 0 ? stripped.search(/[#0?]/) : 0));
      const intPart = (m && m[1]) || '';
      const dec = m && m[3] ? m[3].replace(/[^0?#]/g, '').length : 0;
      const group = /[#0],[#0]/.test(stripped);
      // literal prefix/suffix around the numeric placeholder
      const first = s.search(/[#0?]/), lastIdx = Math.max(s.lastIndexOf('0'), s.lastIndexOf('#'), s.lastIndexOf('?'));
      const lit = (t) => t.replace(/"([^"]*)"/g, '$1').replace(/\\(.)/g, '$1').replace(/[_*]./g, ' ').replace(/%/g, '%');
      const prefix = first >= 0 ? lit(s.slice(0, first)) : '';
      const suffix = lastIdx >= 0 ? lit(s.slice(lastIdx + 1)) : lit(s);
      return { s, isDate, isText, percent, dec, group, prefix, suffix, hasDigits: first >= 0, minInt: (intPart.match(/0/g) || []).length };
    });
    fmtCache.set(fmt, parsed);
    return parsed;
  }
  function serialToDate(v) { return new Date(EPOCH + Math.round(v * 86400000)); }
  function formatDate(v, s) {
    const d = serialToDate(v);
    const Y = d.getUTCFullYear(), M = d.getUTCMonth(), D = d.getUTCDate(), h = d.getUTCHours(), mi = d.getUTCMinutes(), sec = d.getUTCSeconds();
    const ampm = /AM\/PM|A\/P/i.test(s);
    let out = '', i = 0;
    const toks = s.replace(/\\(.)/g, '"$1"');
    const p2 = (n) => String(n).padStart(2, '0');
    const prevIsHour = () => /h+[^dmys]*$/i.test(toks.slice(0, i).replace(/"[^"]*"/g, ''));
    const nextIsSec = () => /^m+[^dmyh]*s/i.test(toks.slice(i).replace(/"[^"]*"/g, ''));
    while (i < toks.length) {
      const rest = toks.slice(i);
      let m;
      if (rest[0] === '"') { const j = toks.indexOf('"', i + 1); out += toks.slice(i + 1, j < 0 ? toks.length : j); i = j < 0 ? toks.length : j + 1; continue; }
      if ((m = /^y{3,4}/i.exec(rest))) { out += Y; i += m[0].length; continue; }
      if ((m = /^y{1,2}/i.exec(rest))) { out += p2(Y % 100); i += m[0].length; continue; }
      if ((m = /^d{4,}/i.exec(rest))) { out += DAYS[d.getUTCDay()]; i += m[0].length; continue; }
      if ((m = /^d{3}/i.exec(rest))) { out += DAYS[d.getUTCDay()].slice(0, 2); i += 3; continue; }
      if ((m = /^dd/i.exec(rest))) { out += p2(D); i += 2; continue; }
      if ((m = /^d/i.exec(rest))) { out += D; i += 1; continue; }
      if ((m = /^h{1,2}/i.exec(rest))) { const hh = ampm ? ((h + 11) % 12) + 1 : h; out += m[0].length === 2 ? p2(hh) : hh; i += m[0].length; continue; }
      if ((m = /^m{1,5}/i.exec(rest))) {
        const len = m[0].length;
        if (len <= 2 && (prevIsHour() || nextIsSec())) out += len === 2 ? p2(mi) : mi;
        else if (len === 5) out += MONTHS[M][0];
        else if (len === 4) out += /d/i.test(toks) ? MONTHS_G[M] : MONTHS[M];
        else if (len === 3) out += MONTHS[M].slice(0, 3);
        else out += len === 2 ? p2(M + 1) : M + 1;
        i += len;
        continue;
      }
      if ((m = /^s{1,2}/i.exec(rest))) { out += m[0].length === 2 ? p2(sec) : sec; i += m[0].length; continue; }
      if ((m = /^(AM\/PM|A\/P)/i.exec(rest))) { out += h < 12 ? 'AM' : 'PM'; i += m[0].length; continue; }
      if (rest[0] === '_' || rest[0] === '*') { out += ' '; i += 2; continue; }
      out += rest[0]; i++;
    }
    return out;
  }
  function formatValue(v, fmt) {
    if (v == null || v === '') return '';
    if (typeof v === 'object' && v.type) return ERR_RU[v.type] || v.value || '#ОШИБКА!';
    if (typeof v === 'boolean') return v ? 'ИСТИНА' : 'ЛОЖЬ';
    if (typeof v === 'string') return v;
    if (!fmt || /^general$/i.test(fmt)) return general(v);
    const secs = parseFmt(fmt);
    let sec = secs[0], val = v;
    if (v < 0 && secs.length > 1 && secs[1].s.trim()) { sec = secs[1]; val = -v; }
    else if (v === 0 && secs.length > 2 && secs[2].s.trim()) sec = secs[2];
    if (sec.isText) return general(v);
    if (sec.isDate) return v < 0 ? '########' : formatDate(val, sec.s);
    if (!sec.hasDigits) return sec.suffix || general(v);
    if (sec.percent) val *= 100;
    let num = fmtNum(Math.abs(val), sec.dec, sec.group);
    if (sec.minInt === 0 && Math.abs(val) < 1 && /^0[,]/.test(num)) num = num.slice(1);
    const neg = val < 0 && !(secs.length > 1 && v < 0) ? '-' : '';
    return neg + sec.prefix + num + sec.suffix;
  }

  // ------------------------------------------------------------ input parsing
  function parseInput(text, curFmt) {
    const t = text;
    if (t === '') return { raw: null };
    if (t[0] === '=' && t.length > 1) return { raw: '=' + normalizeFormula(t.slice(1)) };
    if (t[0] === "'") return { raw: t };
    const s = t.trim().replace(/[\s  ]/g, '');
    let m;
    if (/^(true|истина)$/i.test(s)) return { raw: true };
    if (/^(false|ложь)$/i.test(s)) return { raw: false };
    if ((m = /^([-+]?\d*[.,]?\d+(?:e[-+]?\d+)?)$/i.exec(s))) return { raw: parseFloat(m[1].replace(',', '.')) };
    if ((m = /^([-+]?\d*[.,]?\d+)%$/.exec(s))) {
      const num = parseFloat(m[1].replace(',', '.')) / 100;
      const dec = (m[1].split(/[.,]/)[1] || '').length;
      return { raw: num, fmt: curFmt && /%/.test(curFmt) ? null : dec ? '0.' + '0'.repeat(dec) + '%' : '0%' };
    }
    if ((m = /^([-+]?\d*[.,]?\d+)(₽|р\.?|руб\.?)$/i.exec(s))) return { raw: parseFloat(m[1].replace(',', '.')), fmt: curFmt && /₽/.test(curFmt) ? null : '#,##0.00 "₽"' };
    if ((m = /^\$([-+]?\d*[.,]?\d+)$/.exec(s)) || (m = /^([-+]?\d*[.,]?\d+)\$$/.exec(s))) return { raw: parseFloat(m[1].replace(',', '.')), fmt: '"$"#,##0.00' };
    if ((m = /^([-+]?\d*[.,]?\d+)(€)$/.exec(s))) return { raw: parseFloat(m[1].replace(',', '.')), fmt: '#,##0.00 "€"' };
    // dates dd.mm.yyyy, dd.mm.yy, dd.mm, yyyy-mm-dd, optionally with time
    const tm = /^(.*?)(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t.trim());
    const dpart = tm[1].trim();
    let Y, M, D;
    if ((m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(dpart))) { D = +m[1]; M = +m[2]; Y = m[3] ? +m[3] : new Date().getFullYear(); if (Y < 100) Y += Y < 50 ? 2000 : 1900; }
    else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(dpart))) { Y = +m[1]; M = +m[2]; D = +m[3]; }
    const hasTime = tm[2] != null;
    if ((Y && M >= 1 && M <= 12 && D >= 1 && D <= 31) || (hasTime && dpart === '')) {
      let serial = 0;
      if (Y) serial = (Date.UTC(Y, M - 1, D) - EPOCH) / 86400000;
      if (hasTime) serial += (+tm[2] * 3600 + +tm[3] * 60 + +(tm[4] || 0)) / 86400;
      const fmt = Y && hasTime ? 'dd.mm.yyyy hh:mm' : Y ? 'dd.mm.yyyy' : tm[4] ? 'hh:mm:ss' : 'hh:mm';
      return { raw: serial, fmt: curFmt && (parseFmt(curFmt)[0].isDate) ? null : fmt };
    }
    return { raw: "'" + t };
  }

  function newModel() { return { sheets: [{ name: 'Лист1', cells: {}, cols: {}, rows: {}, merges: [], freeze: null }], active: 0 }; }

  // ======================================================================
  class SheetEditor {
    constructor(root, data, { onDirty }) {
      this.root = root;
      this.onDirty = onDirty;
      this.zoom = 1;
      this.undoStack = [];
      this.redoStack = [];
      this.textColor = '#c00000';
      this.fillColor = '#ffff00';
      const model = (data && data.model) || newModel();
      this.hf = HyperFormula.buildEmpty({
        licenseKey: 'gpl-v3', undoLimit: 100000, leapYear1900: true, nullDate: { year: 1899, month: 12, day: 30 },
        dateFormats: ['DD.MM.YYYY', 'YYYY-MM-DD'], timeFormats: ['hh:mm', 'hh:mm:ss'], smartRounding: true, precisionRounding: 10,
        maxRows: 1048576, maxColumns: 16384, useArrayArithmetic: true,
      });
      this.metas = [];
      this.loadModel(model);
      this.active = Math.min(model.active || 0, this.metas.length - 1);
      this.sel = { r: 0, c: 0, r2: 0, c2: 0 };

      this.buildUI();
      this.bind();
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(this.scroll);
      this.layout();
      if (model.csv) this.autofitAll();
      this.selectionChanged();
      setTimeout(() => this.scroll.focus({ preventScroll: true }), 30);
    }

    // ------------------------------------------------------------ model <-> engine
    loadModel(model) {
      this.hf.batch(() => {
        for (const sh of model.sheets) {
          const name = this.hf.addSheet(sh.name);
          const id = this.hf.getSheetId(name);
          let maxR = -1, maxC = -1;
          for (const k of Object.keys(sh.cells)) { const [r, c] = k.split(':').map(Number); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
          const rows = [];
          for (let r = 0; r <= maxR; r++) rows.push(new Array(maxC + 1).fill(null));
          const styles = new Map();
          for (const [k, cd] of Object.entries(sh.cells)) {
            const [r, c] = k.split(':').map(Number);
            let raw = null;
            if (cd.f) raw = '=' + normalizeFormula(cd.f.replace(/^=/, ''));
            else if (typeof cd.v === 'string' && model.csv) {
              // CSV has no types: recognise dates, percents, money the same way as typed input
              const p = parseInput(cd.v);
              raw = p.raw;
              if (p.fmt) styles.set(k, { ...(cd.s || {}), fmt: p.fmt });
            }
            else if (typeof cd.v === 'string') raw = /^#[A-ZА-Я/0!?]+[!?A-ZА-Я0]*$/.test(cd.v) ? cd.v : "'" + cd.v;
            else raw = cd.v;
            rows[r][c] = raw;
            if (cd.s && !styles.has(k)) styles.set(k, cd.s);
          }
          if (rows.length) this.hf.setSheetContent(id, rows);
          this.metas.push({
            id, styles,
            cols: new Map(Object.entries(sh.cols || {}).map(([c, w]) => [+c, w])),
            rows: new Map(Object.entries(sh.rows || {}).map(([r, h]) => [+r, h])),
            merges: (sh.merges || []).map((m) => m.slice()),
            freeze: sh.freeze ? { rows: sh.freeze.rows || 0, cols: sh.freeze.cols || 0 } : { rows: 0, cols: 0 },
          });
        }
      });
      this.hf.clearUndoStack();
      this.hf.clearRedoStack();
    }
    get meta() { return this.metas[this.active]; }
    get sid() { return this.meta.id; }
    value(r, c, m = this.meta) { return this.hf.getCellValue({ sheet: m.id, row: r, col: c }); }
    rawOf(r, c) {
      const s = this.hf.getCellSerialized({ sheet: this.sid, row: r, col: c });
      if (s == null) return '';
      if (typeof s === 'string' && s[0] === "'") {
        const rest = s.slice(1);
        const p = parseInput(rest);
        return typeof p.raw === 'string' && p.raw[0] === "'" ? rest : s; // keep the apostrophe only where it matters
      }
      if (typeof s === 'boolean') return s ? 'ИСТИНА' : 'ЛОЖЬ';
      if (typeof s === 'number') {
        const st = this.meta.styles.get(key(r, c));
        if (st && st.fmt && parseFmt(st.fmt)[0].isDate) return formatValue(s, /h/i.test(st.fmt) ? 'dd.mm.yyyy hh:mm' : /[dy]/i.test(st.fmt) ? 'dd.mm.yyyy' : 'hh:mm:ss');
        if (st && st.fmt && /%/.test(st.fmt)) return general(+(s * 100).toPrecision(12)) + '%';
        return general(s);
      }
      return String(s);
    }
    display(r, c, m = this.meta) {
      const v = this.value(r, c, m);
      const st = m.styles.get(key(r, c));
      return formatValue(v, st && st.fmt);
    }
    usedSize(m = this.meta) {
      const d = this.hf.getSheetDimensions(m.id);
      let h = d.height, w = d.width;
      for (const k of m.styles.keys()) { const i = k.indexOf(':'); h = Math.max(h, +k.slice(0, i) + 1); w = Math.max(w, +k.slice(i + 1) + 1); }
      return { rows: h, cols: w };
    }

    // ------------------------------------------------------------ undo (HyperFormula undo + meta snapshots)
    snapMeta() {
      return this.metas.map((m) => ({ id: m.id, styles: new Map(m.styles), cols: new Map(m.cols), rows: new Map(m.rows), merges: m.merges.map((x) => x.slice()), freeze: { ...m.freeze } }));
    }
    /** run an edit: fn may change HyperFormula and/or meta; one entry on our undo stack */
    op(fn, { metaChange = false, hfChange = true, batch = true } = {}) {
      const before = metaChange ? this.snapMeta() : null;
      const selBefore = { ...this.sel }, activeBefore = this.active;
      let steps = 0;
      if (hfChange) {
        const d0 = this.hfUndoDepth();
        try { if (batch) this.hf.batch(() => fn()); else fn(); }
        finally { steps = Math.max(0, this.hfUndoDepth() - d0); }
      } else fn();
      this.undoStack.push({ steps, before, after: metaChange ? this.snapMeta() : null, selBefore, selAfter: { ...this.sel }, activeBefore, activeAfter: this.active });
      if (this.undoStack.length > 300) this.undoStack.shift();
      this.redoStack = [];
      this.changed(metaChange);
    }
    hfUndoDepth() { try { return this.hf._crudOperations.undoRedo.undoStack.length; } catch { return 0; } }
    restoreMeta(snap) { this.metas = snap.map((m) => ({ ...m, styles: new Map(m.styles), cols: new Map(m.cols), rows: new Map(m.rows), merges: m.merges.map((x) => x.slice()), freeze: { ...m.freeze } })); }
    undo() {
      if (this.editing) { document.execCommand('undo'); return; }
      const e = this.undoStack.pop();
      if (!e) return;
      for (let i = 0; i < (e.steps || 0) && this.hf.isThereSomethingToUndo(); i++) this.hf.undo();
      if (e.before) this.restoreMeta(e.before);
      this.redoStack.push(e);
      this.active = Math.min(e.activeBefore, this.metas.length - 1);
      this.sel = { ...e.selBefore };
      this.changed(true);
    }
    redo() {
      if (this.editing) { document.execCommand('redo'); return; }
      const e = this.redoStack.pop();
      if (!e) return;
      for (let i = 0; i < (e.steps || 0) && this.hf.isThereSomethingToRedo(); i++) this.hf.redo();
      if (e.after) this.restoreMeta(e.after);
      this.undoStack.push(e);
      this.active = Math.min(e.activeAfter, this.metas.length - 1);
      this.sel = { ...e.selAfter };
      this.changed(true);
    }
    changed(structural) {
      this.onDirty();
      if (structural) { this.renderTabs(); this.mergeIndex(); this.geoDirty = true; }
      else this.updateExtent();
      this.selectionChanged();
    }

    // ------------------------------------------------------------ UI
    buildUI() {
      const sb = (ic, title, fn, label) => btn({ icon: ic, title, label, onClick: fn });
      this.fontSel = select(FONTS, { title: 'Шрифт', width: 120, onChange: (v) => this.setStyle({ font: v === 'Calibri' ? undefined : v }) });
      this.sizeSel = select(SIZES.map(String), { title: 'Размер', width: 54, onChange: (v) => this.setStyle({ size: +v === 11 ? undefined : +v }) });
      this.sizeSel.value = '11';
      this.bBtn = sb('bold', 'Полужирный (Ctrl+B)', () => this.toggleStyle('b'));
      this.iBtn = sb('italic', 'Курсив (Ctrl+I)', () => this.toggleStyle('i'));
      this.uBtn = sb('underline', 'Подчёркнутый (Ctrl+U)', () => this.toggleStyle('u'));
      this.sBtn = sb('strike', 'Зачёркнутый', () => this.toggleStyle('st'));
      const tc = colorButton({ icon: 'textColor', title: 'Цвет текста', get: () => this.textColor, onPick: (c) => { this.textColor = c; this.setStyle({ color: c === '#000000' ? undefined : c }); } });
      const fc = colorButton({ icon: 'paint', title: 'Цвет заливки', fill: true, allowNone: true, noneLabel: 'Нет заливки', get: () => this.fillColor, onPick: (c) => { if (c) this.fillColor = c; this.setStyle({ bg: c || undefined }); } });
      this.alignBtns = {
        left: sb('alignLeft', 'По левому краю', () => this.toggleAlign('left')),
        center: sb('alignCenter', 'По центру', () => this.toggleAlign('center')),
        right: sb('alignRight', 'По правому краю', () => this.toggleAlign('right')),
      };
      const vMenu = sb('vMid', 'Вертикальное выравнивание', (e, b) => this.menuAt(b, [
        { label: 'По верхнему краю', icon: 'vTop', onClick: () => this.setStyle({ v: 'top' }) },
        { label: 'По середине', icon: 'vMid', onClick: () => this.setStyle({ v: 'middle' }) },
        { label: 'По нижнему краю', icon: 'vBot', onClick: () => this.setStyle({ v: undefined }) },
      ]));
      this.wrapBtn = sb('alignJustify', 'Переносить текст', () => this.toggleStyle('wrap'));
      const mergeBtn = sb('table', 'Объединить ячейки / разъединить', () => this.toggleMerge(), 'Объединить');
      const borders = sb('border', 'Границы', (e, b) => this.menuAt(b, [
        { label: 'Все границы', icon: 'grid', onClick: () => this.setBorders('all') },
        { label: 'Внешние границы', icon: 'border', onClick: () => this.setBorders('outer') },
        { label: 'Толстая внешняя', icon: 'border', onClick: () => this.setBorders('thick') },
        { label: 'Нижняя граница', icon: 'hr', onClick: () => this.setBorders('bottom') },
        '-',
        { label: 'Без границ', icon: 'x', onClick: () => this.setBorders('none') },
      ]));
      this.fmtSel = select([
        ['General', 'Общий'], ['0', 'Целое'], ['0.00', 'Числовой'], ['#,##0', 'С разделителями'], ['#,##0.00', 'С разделителями 0,00'],
        ['#,##0.00 "₽"', 'Денежный ₽'], ['"$"#,##0.00', 'Денежный $'], ['#,##0.00 "€"', 'Денежный €'], ['0%', 'Процентный'], ['0.00%', 'Процентный 0,00'],
        ['dd.mm.yyyy', 'Дата'], ['d mmmm yyyy', 'Длинная дата'], ['hh:mm', 'Время'], ['dd.mm.yyyy hh:mm', 'Дата и время'], ['0.00E+00', 'Экспоненциальный'], ['@', 'Текстовый'],
      ], { title: 'Формат чисел', width: 130, onChange: (v) => this.setStyle({ fmt: v === 'General' ? undefined : v }) });
      const insMenu = sb('plus', 'Вставить и удалить строки/столбцы', (e, b) => this.menuAt(b, [
        { label: 'Вставить строку выше', icon: 'up', onClick: () => this.insertRows(this.selRange().r1, this.selRange().r2 - this.selRange().r1 + 1) },
        { label: 'Вставить строку ниже', icon: 'down', onClick: () => this.insertRows(this.selRange().r2 + 1, 1) },
        { label: 'Вставить столбец слева', icon: 'outdent', onClick: () => this.insertCols(this.selRange().c1, this.selRange().c2 - this.selRange().c1 + 1) },
        { label: 'Вставить столбец справа', icon: 'indent', onClick: () => this.insertCols(this.selRange().c2 + 1, 1) },
        '-',
        { label: 'Удалить строки', icon: 'trash', onClick: () => this.deleteRows() },
        { label: 'Удалить столбцы', icon: 'trash', onClick: () => this.deleteCols() },
      ]), 'Строки');
      const sumBtn = btn({ label: 'Σ', title: 'Автосумма (Alt+=)', onClick: () => this.autoSum() });
      sumBtn.querySelector('.lbl').style.cssText = 'font-size:16px;font-weight:600';
      const sortMenu = sb('listOl', 'Сортировка', (e, b) => this.menuAt(b, [
        { label: 'Сортировать от А до Я / по возрастанию', icon: 'down', onClick: () => this.sortSel(1) },
        { label: 'Сортировать от Я до А / по убыванию', icon: 'up', onClick: () => this.sortSel(-1) },
      ]));
      this.freezeBtn = sb('grid', 'Закрепить строки и столбцы при прокрутке', (e, b) => this.freezeMenu(b), 'Закрепить');
      this.root.append(el('div', { class: 'toolbar', style: { '--accent': ACC } }, [
        group(sb('undo', 'Отменить (Ctrl+Z)', () => this.undo()), sb('redo', 'Повторить (Ctrl+Y)', () => this.redo())),
        group(this.fontSel, this.sizeSel, this.bBtn, this.iBtn, this.uBtn, this.sBtn, tc, fc),
        group(this.alignBtns.left, this.alignBtns.center, this.alignBtns.right, vMenu, this.wrapBtn, mergeBtn, borders),
        group(this.fmtSel, sb('outdent', 'Уменьшить разрядность', () => this.changeDecimals(-1)), sb('indent', 'Увеличить разрядность', () => this.changeDecimals(1))),
        group(sumBtn, insMenu, sortMenu, this.freezeBtn),
        group(sb('eraser', 'Очистить форматы', () => this.clearFormats()), sb('search', 'Найти (Ctrl+F)', () => this.find())),
        group(sb('pdf', 'Сохранить в PDF (Ctrl+E)', () => this.exportMenu(), 'PDF'), sb('printer', 'Предпросмотр и печать (Ctrl+P)', () => this.printPreview(), 'Печать')),
      ]));
      // formula bar
      this.nameBox = el('input', { class: 'sh-name', type: 'text', title: 'Адрес ячейки — введите, например, B12, и нажмите Enter' });
      this.fxBtn = el('button', { class: 'sh-fx', title: 'Вставить функцию', html: '<i>fx</i>' });
      this.fbar = el('input', { class: 'sh-fbar', type: 'text', spellcheck: 'false' });
      this.root.append(el('div', { class: 'sh-formula' }, [this.nameBox, this.fxBtn, this.fbar]));
      // grid
      this.canvas = el('canvas', { class: 'sh-canvas' });
      this.spacer = el('div', { class: 'sh-spacer' });
      this.scroll = el('div', { class: 'sh-scroll', tabindex: '0' }, this.spacer);
      this.editor = el('textarea', { class: 'sh-editor', spellcheck: 'false', wrap: 'off' });
      this.editor.style.display = 'none';
      this.gridWrap = el('div', { class: 'sh-grid' }, [this.scroll, this.canvas, this.editor]);
      this.root.append(this.gridWrap);
      // sheet tabs + status
      this.tabsEl = el('div', { class: 'sh-tabs' });
      this.statSel = el('span', { class: 'sh-stat' });
      this.zoomLbl = el('span', { text: '100%', style: { minWidth: '38px', textAlign: 'right' } });
      const zr = el('input', { type: 'range', min: '50', max: '200', step: '10', value: '100', title: 'Масштаб' });
      zr.addEventListener('input', () => this.setZoom(+zr.value / 100));
      this.zoomRange = zr;
      this.root.append(el('div', { class: 'sh-bottom' }, [this.tabsEl, el('span', { class: 'spacer' }), this.statSel, zr, this.zoomLbl]));
      this.renderTabs();
    }
    menuAt(b, items) { const r = b.getBoundingClientRect(); UI.menu(r.left, r.bottom + 4, items); }

    renderTabs() {
      this.tabsEl.innerHTML = '';
      const add = el('button', { class: 'sh-tab-add', title: 'Новый лист', html: icon('plus', 14) });
      add.addEventListener('click', () => this.addSheet());
      this.tabsEl.append(add);
      this.metas.forEach((m, i) => {
        const name = this.hf.getSheetName(m.id);
        const t = el('button', { class: 'sh-tab' + (i === this.active ? ' active' : ''), text: name });
        t.addEventListener('click', () => this.switchSheet(i));
        t.addEventListener('dblclick', () => this.renameSheet(i));
        t.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          UI.menu(e.clientX, e.clientY, [
            { label: 'Переименовать…', icon: 'text', onClick: () => this.renameSheet(i) },
            { label: 'Новый лист', icon: 'plus', onClick: () => this.addSheet() },
            '-',
            { label: 'Удалить лист', icon: 'trash', disabled: this.metas.length < 2, onClick: () => this.deleteSheet(i) },
          ]);
        });
        this.tabsEl.append(t);
      });
    }
    switchSheet(i) {
      this.commitEdit();
      this.active = i;
      this.sel = { r: 0, c: 0, r2: 0, c2: 0 };
      this.scroll.scrollTop = 0; this.scroll.scrollLeft = 0;
      this.renderTabs();
      this.layout();
      this.selectionChanged();
    }
    addSheet() {
      let n = this.metas.length + 1, name;
      do { name = 'Лист' + n++; } while (this.hf.doesSheetExist(name));
      this.op(() => {
        const nm = this.hf.addSheet(name);
        this.metas.push({ id: this.hf.getSheetId(nm), styles: new Map(), cols: new Map(), rows: new Map(), merges: [], freeze: { rows: 0, cols: 0 } });
        this.active = this.metas.length - 1;
        this.sel = { r: 0, c: 0, r2: 0, c2: 0 };
      }, { metaChange: true });
      this.renderTabs();
      this.layout();
    }
    async renameSheet(i) {
      const old = this.hf.getSheetName(this.metas[i].id);
      const r = await modal({ title: 'Переименовать лист', fields: [{ name: 'n', label: 'Имя листа', value: old }], okText: 'Переименовать' });
      if (!r || !r.n || r.n === old) return;
      if (/[\\/?*[\]:]/.test(r.n) || r.n.length > 31) { toast('Имя листа не может содержать символы \\ / ? * [ ] : и быть длиннее 31 знака', 'error'); return; }
      if (this.hf.doesSheetExist(r.n)) { toast('Лист с таким именем уже есть', 'error'); return; }
      this.op(() => this.hf.renameSheet(this.metas[i].id, r.n));
      this.renderTabs();
    }
    async deleteSheet(i) {
      const name = this.hf.getSheetName(this.metas[i].id);
      const ok = await window.api.confirm({ message: `Удалить лист «${name}»?`, detail: 'Формулы на других листах, ссылающиеся на него, покажут #ССЫЛКА!. Отменить можно через Ctrl+Z.', buttons: ['Удалить', 'Отмена'] });
      if (ok !== 0) return;
      this.op(() => {
        this.hf.removeSheet(this.metas[i].id);
        this.metas.splice(i, 1);
        this.active = Math.max(0, Math.min(this.active, this.metas.length - 1));
      }, { metaChange: true });
      this.renderTabs();
      this.layout();
    }

    // ------------------------------------------------------------ geometry
    colW(c, m = this.meta) { const w = m.cols.get(c); return w == null ? DEF_W : w; }
    rowH(r, m = this.meta) { const h = m.rows.get(r); return h == null ? DEF_H : h; }
    updateExtent() {
      const used = this.usedSize();
      const nR = Math.max(1000, used.rows + 200, this.sel.r2 + 50), nC = Math.max(30, used.cols + 10, this.sel.c2 + 10);
      if (nR !== this.nRows || nC !== this.nCols || this.geoDirty) {
        this.nRows = nR; this.nCols = nC; this.geoDirty = false;
        this.colPos = new Float64Array(nC + 1);
        for (let c = 0; c < nC; c++) this.colPos[c + 1] = this.colPos[c] + this.colW(c);
        this.rowPos = new Float64Array(nR + 1);
        // default heights, then adjust for custom rows (sparse) in one pass
        for (let r = 0; r <= nR; r++) this.rowPos[r] = r * DEF_H;
        const custom = [...this.meta.rows.entries()].filter(([r]) => r < nR).sort((a, b) => a[0] - b[0]);
        let acc = 0, k = 0;
        for (let r = 0; r <= nR; r++) {
          this.rowPos[r] += acc;
          while (k < custom.length && custom[k][0] === r) { acc += custom[k][1] - DEF_H; k++; }
        }
        this.spacer.style.width = HDR_W + this.colPos[nC] * this.zoom + 'px';
        this.spacer.style.height = HDR_H + this.rowPos[nR] * this.zoom + 'px';
      }
      this.draw();
    }
    layout() {
      this.geoDirty = true;
      const r = this.scroll.getBoundingClientRect();
      this.W = this.scroll.clientWidth; this.H = this.scroll.clientHeight;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.style.width = this.W + 'px';
      this.canvas.style.height = this.H + 'px';
      this.canvas.width = Math.round(this.W * this.dpr);
      this.canvas.height = Math.round(this.H * this.dpr);
      void r;
      this.mergeIndex();
      this.updateExtent();
    }
    setZoom(z) {
      const ax = this.scroll.scrollLeft / this.zoom, ay = this.scroll.scrollTop / this.zoom;
      this.zoom = Math.max(0.5, Math.min(2, z));
      this.zoomLbl.textContent = Math.round(this.zoom * 100) + '%';
      this.zoomRange.value = Math.round(this.zoom * 100);
      this.geoDirty = true;
      this.updateExtent();
      this.scroll.scrollLeft = ax * this.zoom; this.scroll.scrollTop = ay * this.zoom;
      this.positionEditor();
    }
    mergeIndex() {
      this.mergeAt = new Map();
      for (const m of this.meta.merges) for (let r = m[0]; r <= m[2]; r++) for (let c = m[1]; c <= m[3]; c++) this.mergeAt.set(key(r, c), m);
    }
    search(pos, v) { let lo = 0, hi = pos.length - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (pos[mid] <= v) lo = mid; else hi = mid - 1; } return lo; }
    get fr() { return this.meta.freeze.rows || 0; }
    get fc() { return this.meta.freeze.cols || 0; }
    /** screen x of a column's left edge (frozen columns never scroll) */
    sx(c) { const z = this.zoom; return HDR_W + (c < this.fc ? this.colPos[c] * z : this.colPos[c] * z - this.scroll.scrollLeft); }
    sy(r) { const z = this.zoom; return HDR_H + (r < this.fr ? this.rowPos[r] * z : this.rowPos[r] * z - this.scroll.scrollTop); }
    hit(x, y) {
      const z = this.zoom;
      const fx = this.colPos[this.fc] * z, fy = this.rowPos[this.fr] * z;
      const cx = x - HDR_W < fx ? (x - HDR_W) / z : (x - HDR_W + this.scroll.scrollLeft) / z;
      const cy = y - HDR_H < fy ? (y - HDR_H) / z : (y - HDR_H + this.scroll.scrollTop) / z;
      return { r: Math.max(0, Math.min(this.nRows - 1, this.search(this.rowPos, cy))), c: Math.max(0, Math.min(this.nCols - 1, this.search(this.colPos, cx))) };
    }
    cellRect(r, c) {
      const m = this.mergeAt.get(key(r, c));
      const [r1, c1, r2, c2] = m || [r, c, r, c];
      const x = this.sx(c1), y = this.sy(r1);
      const z = this.zoom;
      return { x, y, w: (this.colPos[c2 + 1] - this.colPos[c1]) * z, h: (this.rowPos[r2 + 1] - this.rowPos[r1]) * z, r1, c1, r2, c2 };
    }
    selRange() { const s = this.sel; return { r1: Math.min(s.r, s.r2), r2: Math.max(s.r, s.r2), c1: Math.min(s.c, s.c2), c2: Math.max(s.c, s.c2) }; }

    // ------------------------------------------------------------ drawing
    draw() {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = null; this.paint(); });
    }
    visible(from, frozen, pos, scroll, size, hdr) {
      const z = this.zoom;
      const out = [];
      for (let i = 0; i < frozen && i < pos.length - 1; i++) out.push(i);
      const start = this.search(pos, (pos[frozen] * z + scroll) / z);
      for (let i = Math.max(start, frozen); i < pos.length - 1; i++) {
        out.push(i);
        if (hdr + pos[i + 1] * z - scroll > size) break;
      }
      return out;
    }
    paint() {
      const ctx = this.canvas.getContext('2d');
      const d = this.dpr, z = this.zoom, m = this.meta;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, this.W, this.H);
      const rows = this.visible(0, this.fr, this.rowPos, this.scroll.scrollTop, this.H, HDR_H);
      const cols = this.visible(0, this.fc, this.colPos, this.scroll.scrollLeft, this.W, HDR_W);
      this.visRows = rows; this.visCols = cols;
      const fx = HDR_W + this.colPos[this.fc] * z, fy = HDR_H + this.rowPos[this.fr] * z;
      // four panes: [frozen rows?][frozen cols?]
      const panes = [
        { rs: rows.filter((r) => r >= this.fr), cs: cols.filter((c) => c >= this.fc), clip: [fx, fy, this.W - fx, this.H - fy] },
        { rs: rows.filter((r) => r < this.fr), cs: cols.filter((c) => c >= this.fc), clip: [fx, HDR_H, this.W - fx, fy - HDR_H] },
        { rs: rows.filter((r) => r >= this.fr), cs: cols.filter((c) => c < this.fc), clip: [HDR_W, fy, fx - HDR_W, this.H - fy] },
        { rs: rows.filter((r) => r < this.fr), cs: cols.filter((c) => c < this.fc), clip: [HDR_W, HDR_H, fx - HDR_W, fy - HDR_H] },
      ];
      for (const p of panes) {
        if (!p.rs.length || !p.cs.length || p.clip[2] <= 0 || p.clip[3] <= 0) continue;
        ctx.save();
        ctx.beginPath();
        ctx.rect(...p.clip);
        ctx.clip();
        this.paintCells(ctx, p.rs, p.cs, m);
        this.paintSelection(ctx);
        ctx.restore();
      }
      if (this.fr) { ctx.strokeStyle = '#9aa3b2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(HDR_W, fy); ctx.lineTo(this.W, fy); ctx.stroke(); }
      if (this.fc) { ctx.strokeStyle = '#9aa3b2'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(fx, HDR_H); ctx.lineTo(fx, this.H); ctx.stroke(); }
      this.paintHeaders(ctx, rows, cols);
    }
    fontOf(st) {
      const z = this.zoom;
      const px = ((st && st.size) || 11) * (96 / 72) * z;
      return `${st && st.i ? 'italic ' : ''}${st && st.b ? 'bold ' : ''}${px}px ${st && st.font ? `'${st.font}', ` : ''}${FONT_FAMILY}`;
    }
    paintCells(ctx, rs, cs, m) {
      const z = this.zoom;
      const x0 = this.sx(cs[0]), y0 = this.sy(rs[0]);
      const x1 = this.sx(cs[cs.length - 1] + 1), y1 = this.sy(rs[rs.length - 1] + 1);
      // fills
      for (const r of rs) for (const c of cs) {
        const st = m.styles.get(key(r, c));
        if (st && st.bg && !this.mergeAt.has(key(r, c))) { ctx.fillStyle = st.bg; ctx.fillRect(this.sx(c), this.sy(r), this.colW(c) * z, this.rowH(r) * z); }
      }
      // grid lines
      ctx.strokeStyle = GRID; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const c of cs) { const x = Math.round(this.sx(c + 1)) - 0.5; ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (const r of rs) { const y = Math.round(this.sy(r + 1)) - 0.5; ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
      // merged areas: cover grid lines, fill
      const seen = new Set();
      for (const r of rs) for (const c of cs) {
        const mg = this.mergeAt.get(key(r, c));
        if (!mg || seen.has(mg)) continue;
        seen.add(mg);
        const rc = this.cellRect(mg[0], mg[1]);
        const st = m.styles.get(key(mg[0], mg[1]));
        ctx.fillStyle = (st && st.bg) || '#ffffff';
        ctx.fillRect(rc.x, rc.y, rc.w - 1, rc.h - 1);
      }
      // text
      const textCells = [];
      for (const r of rs) for (const c of cs) {
        const k = key(r, c);
        const mg = this.mergeAt.get(k);
        if (mg && (mg[0] !== r || mg[1] !== c)) continue;
        const v = this.value(r, c, m);
        if (v == null || v === '') continue;
        textCells.push([r, c, v]);
      }
      // top-left cells of merges whose anchor scrolled out of view
      for (const mg of seen) if (!textCells.some(([r, c]) => r === mg[0] && c === mg[1])) { const v = this.value(mg[0], mg[1], m); if (v != null && v !== '') textCells.push([mg[0], mg[1], v]); }
      for (const [r, c, v] of textCells) this.paintText(ctx, r, c, v, m, cs);
      // borders
      for (const r of rs) for (const c of cs) {
        const st = m.styles.get(key(r, c));
        if (!st || !st.bd) continue;
        const x = this.sx(c), y = this.sy(r), w = this.colW(c) * z, h = this.rowH(r) * z;
        for (const [side, ax, ay, bx, by] of [['t', x, y, x + w, y], ['b', x, y + h, x + w, y + h], ['l', x, y, x, y + h], ['r', x + w, y, x + w, y + h]]) {
          const b = st.bd[side];
          if (!b) continue;
          ctx.strokeStyle = b.c || '#000';
          ctx.lineWidth = /thick/.test(b.s) ? 2.5 : /medium/.test(b.s) ? 1.8 : 1;
          ctx.setLineDash(/dash/.test(b.s) ? [4, 2] : /dot/.test(b.s) ? [1, 2] : []);
          ctx.beginPath();
          ctx.moveTo(Math.round(ax) - 0.5, Math.round(ay) - 0.5); ctx.lineTo(Math.round(bx) - 0.5, Math.round(by) - 0.5);
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
    }
    paintText(ctx, r, c, v, m, cs) {
      const st = m.styles.get(key(r, c));
      const rc = this.cellRect(r, c);
      let text = formatValue(v, st && st.fmt);
      ctx.font = this.fontOf(st);
      const isNum = typeof v === 'number', isErr = typeof v === 'object';
      let h = (st && st.h) || (isNum ? 'right' : typeof v === 'boolean' || isErr ? 'center' : 'left');
      const pad = 3 * this.zoom;
      const fs = ((st && st.size) || 11) * (96 / 72) * this.zoom;
      ctx.fillStyle = (st && st.color) || '#000000';
      const wrap = st && st.wrap;
      let lines = [text];
      if (wrap) {
        lines = [];
        for (const para of text.split('\n')) {
          let line = '';
          for (const word of para.split(' ')) {
            const t = line ? line + ' ' + word : word;
            if (ctx.measureText(t).width > rc.w - 2 * pad && line) { lines.push(line); line = word; } else line = t;
          }
          lines.push(line);
        }
      } else lines = text.split('\n').slice(0, 1);
      const tw = ctx.measureText(lines[0]).width;
      // numbers that do not fit show #### like Excel
      if (isNum && !wrap && tw > rc.w - 2 * pad && !this.mergeAt.has(key(r, c))) { text = '#'.repeat(Math.max(1, Math.floor((rc.w - 2 * pad) / ctx.measureText('#').width))); lines = [text]; h = 'left'; }
      // overflow to the right for left-aligned text when the neighbours are empty
      let clipW = rc.w;
      if (!wrap && !isNum && h === 'left' && tw > rc.w - 2 * pad && !this.mergeAt.has(key(r, c))) {
        let cc = c + 1;
        while (cc < this.nCols && clipW < tw + 2 * pad && cc < c + 30) {
          const nv = this.value(r, cc, m);
          if ((nv != null && nv !== '') || this.mergeAt.has(key(r, cc))) break;
          clipW += this.colW(cc) * this.zoom;
          cc++;
        }
        if (clipW > rc.w) {
          // hide the grid lines under the overflowing text
          const bg = (st && st.bg) || '#ffffff';
          ctx.fillStyle = bg;
          ctx.fillRect(rc.x + rc.w - 1, rc.y, Math.min(clipW, tw + 2 * pad) - rc.w + 1, rc.h - 1);
          ctx.fillStyle = (st && st.color) || '#000000';
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(rc.x, rc.y, clipW, rc.h);
      ctx.clip();
      const lh = fs * 1.2;
      const va = (st && st.v) || 'bottom';
      const total = lines.length * lh;
      let ty = va === 'top' ? rc.y + pad : va === 'middle' ? rc.y + (rc.h - total) / 2 : rc.y + rc.h - total - pad * 0.6;
      ctx.textBaseline = 'top';
      ctx.textAlign = h === 'center' ? 'center' : h === 'right' ? 'right' : 'left';
      const tx = h === 'center' ? rc.x + rc.w / 2 : h === 'right' ? rc.x + rc.w - pad : rc.x + pad;
      for (const line of lines) {
        ctx.fillText(line, tx, ty + fs * 0.1);
        if (st && (st.u || st.st)) {
          const w = ctx.measureText(line).width;
          const lx = h === 'center' ? tx - w / 2 : h === 'right' ? tx - w : tx;
          ctx.fillRect(lx, ty + (st.u ? fs * 1.02 : fs * 0.6), w, Math.max(1, fs / 14));
        }
        ty += lh;
      }
      ctx.restore();
    }
    paintSelection(ctx) {
      const s = this.selRange();
      const a = this.cellRect(s.r1, s.c1), b = this.cellRect(s.r2, s.c2);
      const x = a.x, y = a.y, w = b.x + b.w - a.x, h = b.y + b.h - a.y;
      ctx.fillStyle = 'rgba(29, 111, 66, 0.10)';
      ctx.fillRect(x, y, w, h);
      const ac = this.cellRect(this.sel.r, this.sel.c);
      ctx.fillStyle = '#ffffff';
      if (s.r1 !== s.r2 || s.c1 !== s.c2) {
        // keep the active cell clear, like Excel
        ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.restore();
      }
      ctx.strokeStyle = ACC; ctx.lineWidth = 2;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.lineWidth = 1;
      if (s.r1 !== s.r2 || s.c1 !== s.c2) { ctx.strokeStyle = 'rgba(29,111,66,.5)'; ctx.strokeRect(ac.x + 1.5, ac.y + 1.5, ac.w - 3, ac.h - 3); }
      // fill handle
      ctx.fillStyle = ACC;
      ctx.fillRect(x + w - 4, y + h - 4, 7, 7);
      ctx.strokeStyle = '#ffffff';
      ctx.strokeRect(x + w - 4.5, y + h - 4.5, 8, 8);
      this.handleRect = { x: x + w - 5, y: y + h - 5, w: 10, h: 10 };
      if (this.fillPreview) {
        const f = this.fillPreview;
        const p = this.cellRect(f.r1, f.c1), q = this.cellRect(f.r2, f.c2);
        ctx.setLineDash([4, 3]); ctx.strokeStyle = '#555'; ctx.lineWidth = 1;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, q.x + q.w - p.x - 1, q.y + q.h - p.y - 1);
        ctx.setLineDash([]);
      }
      if (this.refPreview) {
        const f = this.refPreview;
        const p = this.cellRect(f.r1, f.c1), q = this.cellRect(f.r2, f.c2);
        ctx.setLineDash([5, 3]); ctx.strokeStyle = '#2b6cdf'; ctx.lineWidth = 2;
        ctx.strokeRect(p.x + 1, p.y + 1, q.x + q.w - p.x - 2, q.y + q.h - p.y - 2);
        ctx.setLineDash([]);
      }
    }
    paintHeaders(ctx, rows, cols) {
      const s = this.selRange(), z = this.zoom;
      ctx.font = `${12}px 'Segoe UI', Arial, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      // column headers
      ctx.fillStyle = HDR_BG; ctx.fillRect(HDR_W, 0, this.W, HDR_H);
      for (const c of cols) {
        const x = this.sx(c), w = this.colW(c) * z;
        const fxe = HDR_W + this.colPos[this.fc] * z;
        if (c >= this.fc && x + w <= fxe) continue;
        ctx.save();
        if (c >= this.fc) { ctx.beginPath(); ctx.rect(fxe, 0, this.W, HDR_H); ctx.clip(); }
        const on = c >= s.c1 && c <= s.c2;
        if (on) { ctx.fillStyle = HDR_SEL; ctx.fillRect(x, 0, w, HDR_H); ctx.fillStyle = ACC; ctx.fillRect(x, HDR_H - 2, w, 2); }
        ctx.fillStyle = on ? ACC : '#4a5260';
        ctx.fillText(colName(c), x + w / 2, HDR_H / 2 + 1);
        ctx.fillStyle = '#d5d9df'; ctx.fillRect(Math.round(x + w) - 1, 0, 1, HDR_H);
        ctx.restore();
      }
      // row headers
      ctx.fillStyle = HDR_BG; ctx.fillRect(0, HDR_H, HDR_W, this.H);
      for (const r of rows) {
        const y = this.sy(r), h = this.rowH(r) * z;
        const fye = HDR_H + this.rowPos[this.fr] * z;
        if (r >= this.fr && y + h <= fye) continue;
        ctx.save();
        if (r >= this.fr) { ctx.beginPath(); ctx.rect(0, fye, HDR_W, this.H); ctx.clip(); }
        const on = r >= s.r1 && r <= s.r2;
        if (on) { ctx.fillStyle = HDR_SEL; ctx.fillRect(0, y, HDR_W, h); ctx.fillStyle = ACC; ctx.fillRect(HDR_W - 2, y, 2, h); }
        ctx.fillStyle = on ? ACC : '#4a5260';
        ctx.fillText(String(r + 1), HDR_W / 2, y + h / 2 + 1);
        ctx.fillStyle = '#d5d9df'; ctx.fillRect(0, Math.round(y + h) - 1, HDR_W, 1);
        ctx.restore();
      }
      ctx.fillStyle = '#e8eaee'; ctx.fillRect(0, 0, HDR_W, HDR_H);
      ctx.fillStyle = '#c3c9d1'; ctx.beginPath(); ctx.moveTo(HDR_W - 4, HDR_H - 4); ctx.lineTo(HDR_W - 4, 6); ctx.lineTo(HDR_W - 16, HDR_H - 4); ctx.fill();
      ctx.fillStyle = '#c9ced6'; ctx.fillRect(0, HDR_H - 1, this.W, 1); ctx.fillRect(HDR_W - 1, 0, 1, this.H);
    }

    // ------------------------------------------------------------ selection & editing
    selectionChanged() {
      const s = this.sel;
      this.nameBox.value = s.r === s.r2 && s.c === s.c2 ? addr(s.r, s.c) : `${addr(Math.min(s.r, s.r2), Math.min(s.c, s.c2))}:${addr(Math.max(s.r, s.r2), Math.max(s.c, s.c2))}`;
      if (!this.editing && document.activeElement !== this.fbar) this.fbar.value = this.rawOf(s.r, s.c);
      const st = this.meta.styles.get(key(s.r, s.c)) || {};
      this.bBtn.classList.toggle('on', !!st.b); this.iBtn.classList.toggle('on', !!st.i); this.uBtn.classList.toggle('on', !!st.u); this.sBtn.classList.toggle('on', !!st.st);
      this.wrapBtn.classList.toggle('on', !!st.wrap);
      for (const [k, b] of Object.entries(this.alignBtns)) b.classList.toggle('on', st.h === k);
      const sz = String(st.size || 11);
      if (![...this.sizeSel.options].some((o) => o.value === sz)) this.sizeSel.append(el('option', { value: sz, text: sz }));
      this.sizeSel.value = sz;
      const f = st.font || 'Calibri';
      if (![...this.fontSel.options].some((o) => o.value === f)) this.fontSel.append(el('option', { value: f, text: f }));
      this.fontSel.value = f;
      const fmt = st.fmt || 'General';
      if (![...this.fmtSel.options].some((o) => o.value === fmt)) this.fmtSel.append(el('option', { value: fmt, text: fmt }));
      this.fmtSel.value = fmt;
      this.freezeBtn.classList.toggle('on', !!(this.fr || this.fc));
      this.updateStats();
      this.updateExtent();
    }
    updateStats() {
      const s = this.selRange();
      const n = (s.r2 - s.r1 + 1) * (s.c2 - s.c1 + 1);
      if (n < 2 || n > 2e6) { this.statSel.textContent = ''; return; }
      const used = this.usedSize();
      let sum = 0, cnt = 0, nums = 0;
      for (let r = s.r1; r <= Math.min(s.r2, used.rows - 1); r++) for (let c = s.c1; c <= Math.min(s.c2, used.cols - 1); c++) {
        const v = this.value(r, c);
        if (v == null || v === '') continue;
        cnt++;
        if (typeof v === 'number') { sum += v; nums++; }
      }
      const st = this.meta.styles.get(key(s.r1, s.c1));
      const f = (x) => formatValue(x, st && st.fmt && !parseFmt(st.fmt)[0].isDate ? st.fmt : null);
      this.statSel.textContent = nums ? `Среднее: ${f(sum / nums)}   Количество: ${cnt}   Сумма: ${f(sum)}` : cnt ? `Количество: ${cnt}` : '';
    }
    moveTo(r, c, extend) {
      r = Math.max(0, Math.min(r, 1048575)); c = Math.max(0, Math.min(c, 16383));
      if (extend) { this.sel.r2 = r; this.sel.c2 = c; } else this.sel = { r, c, r2: r, c2: c };
      this.ensureVisible(extend ? this.sel.r2 : r, extend ? this.sel.c2 : c);
      this.selectionChanged();
    }
    ensureVisible(r, c) {
      this.updateExtent();
      const z = this.zoom;
      if (r >= this.fr) {
        const top = this.rowPos[r] * z, bot = this.rowPos[Math.min(r + 1, this.nRows)] * z, fy = this.rowPos[this.fr] * z;
        const viewTop = this.scroll.scrollTop + fy, viewBot = this.scroll.scrollTop + this.H - HDR_H - 18;
        if (top < viewTop) this.scroll.scrollTop = top - fy;
        else if (bot > viewBot) this.scroll.scrollTop = bot - (this.H - HDR_H - 18);
      }
      if (c >= this.fc) {
        const l = this.colPos[c] * z, rr = this.colPos[Math.min(c + 1, this.nCols)] * z, fx = this.colPos[this.fc] * z;
        const viewL = this.scroll.scrollLeft + fx, viewR = this.scroll.scrollLeft + this.W - HDR_W - 18;
        if (l < viewL) this.scroll.scrollLeft = l - fx;
        else if (rr > viewR) this.scroll.scrollLeft = rr - (this.W - HDR_W - 18);
      }
    }
    startEdit(initial, keepContent) {
      const s = this.sel;
      this.sel = { r: s.r, c: s.c, r2: s.r, c2: s.c };
      this.editing = { r: s.r, c: s.c };
      const ed = this.editor;
      ed.value = keepContent ? this.rawOf(s.r, s.c) : initial || '';
      const st = this.meta.styles.get(key(s.r, s.c)) || {};
      ed.style.font = this.fontOf(st);
      ed.style.color = st.color || '#000';
      ed.style.background = st.bg || '#fff';
      ed.style.textAlign = st.h === 'center' ? 'center' : st.h === 'right' ? 'right' : 'left';
      ed.style.display = 'block';
      this.positionEditor();
      ed.focus();
      ed.setSelectionRange(ed.value.length, ed.value.length);
      this.fbar.value = ed.value;
      this.selectionChanged();
    }
    positionEditor() {
      if (!this.editing) return;
      const rc = this.cellRect(this.editing.r, this.editing.c);
      const ed = this.editor;
      ed.style.left = rc.x + 'px';
      ed.style.top = rc.y + 'px';
      ed.style.minWidth = rc.w + 'px';
      ed.style.height = Math.max(rc.h, ed.scrollHeight) + 'px';
      // grow to fit text
      const ctx = this.canvas.getContext('2d');
      ctx.font = ed.style.font;
      const w = Math.max(...ed.value.split('\n').map((l) => ctx.measureText(l).width)) + 16;
      ed.style.width = Math.max(rc.w, Math.min(w, this.W - rc.x - 4)) + 'px';
    }
    commitEdit(text) {
      if (!this.editing) return false;
      const { r, c } = this.editing;
      const val = text != null ? text : this.editor.value;
      this.editing = null;
      this.refPreview = null;
      this.editor.style.display = 'none';
      this.writeCell(r, c, val);
      this.scroll.focus({ preventScroll: true });
      return true;
    }
    cancelEdit() {
      if (!this.editing) return;
      this.editing = null;
      this.refPreview = null;
      this.editor.style.display = 'none';
      this.fbar.value = this.rawOf(this.sel.r, this.sel.c);
      this.scroll.focus({ preventScroll: true });
      this.draw();
    }
    writeCell(r, c, text) {
      const st = this.meta.styles.get(key(r, c));
      const p = parseInput(text, st && st.fmt);
      const prev = this.hf.getCellSerialized({ sheet: this.sid, row: r, col: c });
      if (prev === p.raw && !p.fmt) { this.draw(); return; }
      const fmtChange = p.fmt && (!st || st.fmt !== p.fmt);
      this.op(() => {
        this.hf.setCellContents({ sheet: this.sid, row: r, col: c }, [[p.raw]]);
        if (fmtChange) this.meta.styles.set(key(r, c), { ...(st || {}), fmt: p.fmt });
      }, { metaChange: !!fmtChange });
      const v = this.value(r, c);
      // like Excel: a column of default width grows to fit a number or date typed into it
      if (typeof v === 'number' && !this.meta.cols.has(c) && !this.mergeAt.has(key(r, c))) {
        const ctx = this.canvas.getContext('2d');
        ctx.font = this.fontOf(this.meta.styles.get(key(r, c)));
        const need = ctx.measureText(this.display(r, c)).width / this.zoom + 8;
        if (need > DEF_W) { this.meta.cols.set(c, Math.ceil(need)); this.geoDirty = true; this.updateExtent(); }
      }
      if (v && typeof v === 'object' && v.type === 'ERROR' && p.raw && String(p.raw)[0] === '=') toast('Ошибка в формуле: ' + (v.message || 'проверьте синтаксис'), 'error', 5000);
    }
    /** while typing a formula, a click on the grid inserts a reference */
    formulaRefMode() {
      if (!this.editing) return false;
      const ed = this.editor;
      if (ed.value[0] !== '=') return false;
      const before = ed.value.slice(0, ed.selectionStart).replace(this.lastRef && ed.value.slice(0, ed.selectionStart).endsWith(this.lastRef) ? this.lastRef : '', '');
      return /[=(,;+\-*/&^<>:]\s*$/.test(before);
    }
    insertRef(r1, c1, r2, c2) {
      const ed = this.editor;
      const ref = r1 === r2 && c1 === c2 ? addr(r1, c1) : `${addr(Math.min(r1, r2), Math.min(c1, c2))}:${addr(Math.max(r1, r2), Math.max(c1, c2))}`;
      let start = ed.selectionStart;
      if (this.lastRef && ed.value.slice(0, start).endsWith(this.lastRef)) start -= this.lastRef.length;
      ed.value = ed.value.slice(0, start) + ref + ed.value.slice(ed.selectionEnd);
      ed.setSelectionRange(start + ref.length, start + ref.length);
      this.lastRef = ref;
      this.fbar.value = ed.value;
      this.refPreview = { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
      this.positionEditor();
      this.draw();
    }

    // ------------------------------------------------------------ editing operations
    rangeCells(fn, limitToUsed = true) {
      const s = this.selRange();
      const used = this.usedSize();
      const r2 = limitToUsed && s.r2 - s.r1 > 5000 ? Math.max(s.r1, Math.min(s.r2, used.rows + 10)) : s.r2;
      const c2 = limitToUsed && s.c2 - s.c1 > 500 ? Math.max(s.c1, Math.min(s.c2, used.cols + 5)) : s.c2;
      for (let r = s.r1; r <= r2; r++) for (let c = s.c1; c <= c2; c++) fn(r, c);
    }
    setStyle(patch) {
      this.commitEdit();
      this.op(() => {
        this.rangeCells((r, c) => {
          const k = key(r, c);
          const st = { ...(this.meta.styles.get(k) || {}), ...patch };
          for (const kk of Object.keys(st)) if (st[kk] === undefined || st[kk] === false) delete st[kk];
          if (Object.keys(st).length) this.meta.styles.set(k, st); else this.meta.styles.delete(k);
        });
      }, { metaChange: true, hfChange: false });
      this.scroll.focus({ preventScroll: true });
    }
    toggleStyle(k) { const st = this.meta.styles.get(key(this.sel.r, this.sel.c)) || {}; this.setStyle({ [k]: st[k] ? undefined : 1 }); }
    toggleAlign(h) { const st = this.meta.styles.get(key(this.sel.r, this.sel.c)) || {}; this.setStyle({ h: st.h === h ? undefined : h }); }
    clearFormats() { this.op(() => this.rangeCells((r, c) => this.meta.styles.delete(key(r, c))), { metaChange: true, hfChange: false }); }
    changeDecimals(d) {
      const st = this.meta.styles.get(key(this.sel.r, this.sel.c)) || {};
      let fmt = st.fmt || '';
      const v = this.value(this.sel.r, this.sel.c);
      if (!fmt || fmt === 'General') { const dec = typeof v === 'number' ? (general(v).split(',')[1] || '').length : 0; fmt = dec ? '0.' + '0'.repeat(dec) : '0'; }
      if (d > 0) fmt = /\.0+/.test(fmt) ? fmt.replace(/\.(0+)/, '.$10') : fmt.replace(/(0)(?!.*0)/, '$1.0');
      else fmt = fmt.replace(/\.(0*)0(?=[^0]|$)/, (m, z) => (z ? '.' + z : ''));
      this.setStyle({ fmt });
    }
    setBorders(mode) {
      const s = this.selRange();
      const thin = { s: 'thin', c: '#000000' }, thick = { s: 'medium', c: '#000000' };
      this.op(() => this.rangeCells((r, c) => {
        const k = key(r, c);
        const st = { ...(this.meta.styles.get(k) || {}) };
        const bd = mode === 'none' || mode === 'all' ? {} : { ...(st.bd || {}) };
        if (mode === 'all') Object.assign(bd, { t: thin, r: thin, b: thin, l: thin });
        if (mode === 'outer' || mode === 'thick') {
          const b = mode === 'thick' ? thick : thin;
          if (r === s.r1) bd.t = b; if (r === s.r2) bd.b = b; if (c === s.c1) bd.l = b; if (c === s.c2) bd.r = b;
        }
        if (mode === 'bottom' && r === s.r2) bd.b = thin;
        if (Object.keys(bd).length) st.bd = bd; else delete st.bd;
        if (Object.keys(st).length) this.meta.styles.set(k, st); else this.meta.styles.delete(k);
      }), { metaChange: true, hfChange: false });
    }
    toggleMerge() {
      const s = this.selRange();
      const m = this.meta;
      const exact = m.merges.findIndex((x) => x[0] === s.r1 && x[1] === s.c1 && x[2] === s.r2 && x[3] === s.c2);
      const inside = m.merges.findIndex((x) => s.r1 >= x[0] && s.r2 <= x[2] && s.c1 >= x[1] && s.c2 <= x[3]);
      if (exact >= 0 || (inside >= 0 && s.r1 === s.r2 && s.c1 === s.c2)) {
        this.op(() => { m.merges.splice(exact >= 0 ? exact : inside, 1); }, { metaChange: true, hfChange: false });
      } else {
        if (s.r1 === s.r2 && s.c1 === s.c2) return;
        let lost = 0;
        for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) if ((r !== s.r1 || c !== s.c1) && this.value(r, c) != null) lost++;
        this.op(() => {
          m.merges = m.merges.filter((x) => x[2] < s.r1 || x[0] > s.r2 || x[3] < s.c1 || x[1] > s.c2);
          m.merges.push([s.r1, s.c1, s.r2, s.c2]);
          for (let r = s.r1; r <= s.r2; r++) for (let c = s.c1; c <= s.c2; c++) if (r !== s.r1 || c !== s.c1) this.hf.setCellContents({ sheet: m.id, row: r, col: c }, [[null]]);
          const st = { ...(m.styles.get(key(s.r1, s.c1)) || {}), h: 'center', v: 'middle' };
          m.styles.set(key(s.r1, s.c1), st);
        }, { metaChange: true });
        if (lost) toast('В объединённой ячейке сохранено только значение левой верхней ячейки', null, 4000);
      }
      this.sel = { r: s.r1, c: s.c1, r2: s.r2, c2: s.c2 };
      this.mergeIndex();
      this.draw();
    }
    freezeMenu(b) {
      const on = this.fr || this.fc;
      this.menuAt(b, [
        { label: 'Закрепить области (выше и левее выделенной ячейки)', icon: 'grid', disabled: !this.sel.r && !this.sel.c, onClick: () => this.setFreeze(this.sel.r, this.sel.c) },
        { label: 'Закрепить верхнюю строку', icon: 'up', onClick: () => this.setFreeze(1, 0) },
        { label: 'Закрепить первый столбец', icon: 'outdent', onClick: () => this.setFreeze(0, 1) },
        '-',
        { label: 'Снять закрепление', icon: 'x', disabled: !on, onClick: () => this.setFreeze(0, 0) },
      ]);
    }
    setFreeze(rows, cols) {
      const m = this.meta;
      this.op(() => { m.freeze = { rows, cols }; }, { metaChange: true, hfChange: false });
      this.scroll.scrollTop = 0; this.scroll.scrollLeft = 0;
      toast(rows || cols ? `Закреплено: строк — ${rows}, столбцов — ${cols}` : 'Закрепление снято');
      this.selectionChanged();
    }
    clearCells() {
      const s = this.selRange();
      const used = this.usedSize();
      const r2 = Math.min(s.r2, used.rows - 1), c2 = Math.min(s.c2, used.cols - 1);
      if (r2 < s.r1 || c2 < s.c1) return;
      const empty = Array.from({ length: r2 - s.r1 + 1 }, () => new Array(c2 - s.c1 + 1).fill(null));
      this.op(() => this.hf.setCellContents({ sheet: this.sid, row: s.r1, col: s.c1 }, empty));
    }
    shiftMeta(axis, at, delta) {
      const m = this.meta;
      const styles = new Map();
      for (const [k, st] of m.styles) {
        let [r, c] = k.split(':').map(Number);
        const v = axis === 'r' ? r : c;
        if (delta < 0 && v >= at && v < at - delta) continue;
        if (v >= at) { if (axis === 'r') r += delta; else c += delta; }
        styles.set(key(r, c), st);
      }
      m.styles = styles;
      const sizes = axis === 'r' ? m.rows : m.cols;
      const ns = new Map();
      for (const [i, v] of sizes) { if (delta < 0 && i >= at && i < at - delta) continue; ns.set(i >= at ? i + delta : i, v); }
      if (axis === 'r') m.rows = ns; else m.cols = ns;
      m.merges = m.merges.map((x) => {
        const [a, b] = axis === 'r' ? [0, 2] : [1, 3];
        const y = x.slice();
        if (delta > 0) { if (y[a] >= at) y[a] += delta; if (y[b] >= at) y[b] += delta; }
        else { const n = -delta; const shift = (v) => (v >= at + n ? v - n : v >= at ? at : v); y[a] = shift(y[a]); y[b] = y[b] >= at && y[b] < at + n ? at - 1 : shift(y[b]); if (y[b] < y[a]) return null; }
        return y;
      }).filter((y) => y && (y[2] > y[0] || y[3] > y[1]));
    }
    insertRows(at, n) { this.op(() => { this.hf.addRows(this.sid, [at, n]); this.shiftMeta('r', at, n); }, { metaChange: true }); this.geoDirty = true; this.mergeIndex(); this.updateExtent(); }
    insertCols(at, n) { this.op(() => { this.hf.addColumns(this.sid, [at, n]); this.shiftMeta('c', at, n); }, { metaChange: true }); this.geoDirty = true; this.mergeIndex(); this.updateExtent(); }
    deleteRows() { const s = this.selRange(); this.op(() => { this.hf.removeRows(this.sid, [s.r1, s.r2 - s.r1 + 1]); this.shiftMeta('r', s.r1, -(s.r2 - s.r1 + 1)); }, { metaChange: true }); this.geoDirty = true; this.mergeIndex(); this.moveTo(s.r1, s.c1); }
    deleteCols() { const s = this.selRange(); this.op(() => { this.hf.removeColumns(this.sid, [s.c1, s.c2 - s.c1 + 1]); this.shiftMeta('c', s.c1, -(s.c2 - s.c1 + 1)); }, { metaChange: true }); this.geoDirty = true; this.mergeIndex(); this.moveTo(s.r1, s.c1); }
    autoSum() {
      this.commitEdit();
      const s = this.selRange();
      const isNum = (r, c) => typeof this.value(r, c) === 'number';
      if (s.r1 === s.r2 && s.c1 === s.c2) {
        let r = s.r1 - 1;
        while (r >= 0 && isNum(r, s.c1)) r--;
        if (r < s.r1 - 1) { this.writeCell(s.r1, s.c1, `=SUM(${addr(r + 1, s.c1)}:${addr(s.r1 - 1, s.c1)})`); return; }
        let c = s.c1 - 1;
        while (c >= 0 && isNum(s.r1, c)) c--;
        if (c < s.c1 - 1) { this.writeCell(s.r1, s.c1, `=SUM(${addr(s.r1, c + 1)}:${addr(s.r1, s.c1 - 1)})`); return; }
        this.startEdit('=SUM()');
        this.editor.setSelectionRange(5, 5);
        return;
      }
      // a range: put sums below each column
      this.op(() => {
        for (let c = s.c1; c <= s.c2; c++) this.hf.setCellContents({ sheet: this.sid, row: s.r2 + 1, col: c }, [[`=SUM(${addr(s.r1, c)}:${addr(s.r2, c)})`]]);
      });
    }
    sortSel(dir) {
      const s = this.selRange();
      const used = this.usedSize();
      const r2 = Math.min(s.r2, used.rows - 1);
      if (r2 <= s.r1) { toast('Выделите диапазон из нескольких строк'); return; }
      const rows = [];
      for (let r = s.r1; r <= r2; r++) {
        const raw = [], sts = [];
        for (let c = s.c1; c <= s.c2; c++) { raw.push(this.hf.getCellSerialized({ sheet: this.sid, row: r, col: c })); sts.push(this.meta.styles.get(key(r, c))); }
        rows.push({ v: this.value(r, s.c1), raw, sts });
      }
      const cmp = (a, b) => {
        const x = a.v, y = b.v;
        if (x == null || x === '') return 1;
        if (y == null || y === '') return -1;
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
        return String(x).localeCompare(String(y), 'ru', { numeric: true }) * dir;
      };
      rows.sort(cmp);
      this.op(() => {
        this.hf.setCellContents({ sheet: this.sid, row: s.r1, col: s.c1 }, rows.map((x) => x.raw));
        rows.forEach((x, i) => x.sts.forEach((st, j) => { const k = key(s.r1 + i, s.c1 + j); if (st) this.meta.styles.set(k, st); else this.meta.styles.delete(k); }));
      }, { metaChange: true });
    }

    // ------------------------------------------------------------ clipboard & fill
    tsv(range) {
      const lines = [];
      for (let r = range.r1; r <= range.r2; r++) {
        const row = [];
        for (let c = range.c1; c <= range.c2; c++) { let t = this.display(r, c); if (/[\t\n"]/.test(t)) t = '"' + t.replace(/"/g, '""') + '"'; row.push(t); }
        lines.push(row.join('\t'));
      }
      return lines.join('\n');
    }
    htmlTable(range) {
      let h = '<table>';
      for (let r = range.r1; r <= range.r2; r++) {
        h += '<tr>';
        for (let c = range.c1; c <= range.c2; c++) {
          const st = this.meta.styles.get(key(r, c)) || {};
          const css = [st.b && 'font-weight:bold', st.i && 'font-style:italic', st.color && `color:${st.color}`, st.bg && `background:${st.bg}`, st.h && `text-align:${st.h}`].filter(Boolean).join(';');
          h += `<td${css ? ` style="${css}"` : ''}>${UI.esc(this.display(r, c))}</td>`;
        }
        h += '</tr>';
      }
      return h + '</table>';
    }
    copy(e, cut) {
      const range = this.selRange();
      const used = this.usedSize();
      range.r2 = Math.min(range.r2, Math.max(range.r1, used.rows - 1));
      range.c2 = Math.min(range.c2, Math.max(range.c1, used.cols - 1));
      const text = this.tsv(range);
      e.clipboardData.setData('text/plain', text);
      e.clipboardData.setData('text/html', this.htmlTable(range));
      e.preventDefault();
      const styles = [];
      for (let r = range.r1; r <= range.r2; r++) { const row = []; for (let c = range.c1; c <= range.c2; c++) row.push(this.meta.styles.get(key(r, c))); styles.push(row); }
      this.clip = { text, range, sheet: this.sid, styles, cut };
      const rng = { start: { sheet: this.sid, row: range.r1, col: range.c1 }, end: { sheet: this.sid, row: range.r2, col: range.c2 } };
      if (cut) this.hf.cut(rng); else this.hf.copy(rng);
      toast(cut ? 'Вырезано' : `Скопировано: ${(range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1)} яч.`);
    }
    paste(e) {
      const text = e.clipboardData.getData('text/plain');
      e.preventDefault();
      const { r, c } = this.sel;
      if (this.clip && text === this.clip.text && this.hf.isClipboardEmpty() === false) {
        const cl = this.clip;
        this.op(() => {
          this.hf.paste({ sheet: this.sid, row: r, col: c });
          const srcMeta = this.metas.find((m) => m.id === cl.sheet);
          if (cl.cut && srcMeta) for (let rr = cl.range.r1; rr <= cl.range.r2; rr++) for (let cc = cl.range.c1; cc <= cl.range.c2; cc++) srcMeta.styles.delete(key(rr, cc));
          cl.styles.forEach((row, i) => row.forEach((st, j) => { const k = key(r + i, c + j); if (st) this.meta.styles.set(k, st); else this.meta.styles.delete(k); }));
          if (cl.cut) { this.clip = null; }
        }, { metaChange: true, batch: false });
        this.sel = { r, c, r2: r + cl.range.r2 - cl.range.r1, c2: c + cl.range.c2 - cl.range.c1 };
        this.selectionChanged();
        return;
      }
      if (!text) return;
      // external data (Excel, Word, browser): tab separated
      const rows = [];
      let row = [], field = '', q = false;
      const t = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (q) { if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += ch; }
        else if (ch === '"' && field === '') q = true;
        else if (ch === '\t') { row.push(field); field = ''; }
        else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += ch;
      }
      row.push(field); rows.push(row);
      const fmts = [];
      const data = rows.map((rw, i) => rw.map((v, j) => { const p = parseInput(v); if (p.fmt) fmts.push([r + i, c + j, p.fmt]); return p.raw; }));
      const w = Math.max(...data.map((x) => x.length));
      data.forEach((x) => { while (x.length < w) x.push(null); });
      this.op(() => {
        this.hf.setCellContents({ sheet: this.sid, row: r, col: c }, data);
        for (const [rr, cc, f] of fmts) this.meta.styles.set(key(rr, cc), { ...(this.meta.styles.get(key(rr, cc)) || {}), fmt: f });
      }, { metaChange: fmts.length > 0 });
      this.sel = { r, c, r2: r + data.length - 1, c2: c + w - 1 };
      this.selectionChanged();
    }
    /** drag the fill handle: numbers continue a series, everything else (incl. formulas) is copied with relative references */
    fill(src, dst) {
      const down = dst.r2 > src.r2, up = dst.r1 < src.r1, right = dst.c2 > src.c2, left = dst.c1 < src.c1;
      if (!down && !up && !right && !left) return;
      this.op(() => {
        const vertical = down || up;
        const lines = vertical ? src.c2 - src.c1 + 1 : src.r2 - src.r1 + 1;
        const len = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
        for (let li = 0; li < lines; li++) {
          const at = (i) => (vertical ? [src.r1 + i, src.c1 + li] : [src.r1 + li, src.c1 + i]);
          const raws = [], vals = [];
          for (let i = 0; i < len; i++) { const [r, c] = at(i); raws.push(this.hf.getCellSerialized({ sheet: this.sid, row: r, col: c })); vals.push(raws[i]); }
          const numeric = len >= 2 && raws.every((x) => typeof x === 'number');
          const step = numeric ? (raws[len - 1] - raws[0]) / (len - 1) : 0;
          const targets = [];
          if (down || right) { const end = down ? dst.r2 - src.r2 : dst.c2 - src.c2; for (let k = 1; k <= end; k++) targets.push(len - 1 + k); }
          else { const end = up ? src.r1 - dst.r1 : src.c1 - dst.c1; for (let k = 1; k <= end; k++) targets.push(-k); }
          for (const t of targets) {
            const [r, c] = vertical ? [src.r1 + t, src.c1 + li] : [src.r1 + li, src.c1 + t];
            const si = ((t % len) + len) % len;
            const [sr, sc] = at(si);
            if (numeric) this.hf.setCellContents({ sheet: this.sid, row: r, col: c }, [[raws[0] + step * t]]);
            else {
              this.hf.copy({ start: { sheet: this.sid, row: sr, col: sc }, end: { sheet: this.sid, row: sr, col: sc } });
              this.hf.paste({ sheet: this.sid, row: r, col: c });
            }
            const st = this.meta.styles.get(key(sr, sc));
            if (st) this.meta.styles.set(key(r, c), st); else this.meta.styles.delete(key(r, c));
          }
        }
      }, { metaChange: true, batch: false });
      this.sel = { r: Math.min(src.r1, dst.r1), c: Math.min(src.c1, dst.c1), r2: Math.max(src.r2, dst.r2), c2: Math.max(src.c2, dst.c2) };
      this.selectionChanged();
    }
    async find() {
      const r = await modal({ title: 'Найти', fields: [{ name: 'q', label: 'Что искать', value: this.lastFind || '' }], okText: 'Найти далее' });
      if (!r || !r.q) return;
      this.lastFind = r.q;
      this.findNext();
    }
    findNext() {
      const q = (this.lastFind || '').toLowerCase();
      if (!q) return this.find();
      const used = this.usedSize();
      const total = used.rows * used.cols;
      let idx = this.sel.r * used.cols + this.sel.c;
      for (let n = 0; n < total; n++) {
        idx = (idx + 1) % total;
        const r = Math.floor(idx / used.cols), c = idx % used.cols;
        if (this.display(r, c).toLowerCase().includes(q) || String(this.rawOf(r, c)).toLowerCase().includes(q)) { this.moveTo(r, c); return; }
      }
      toast('Ничего не найдено');
    }
    autofitAll() {
      const used = this.usedSize();
      for (let c = 0; c < Math.min(used.cols, 200); c++) { const w = this.autofitCol(c); if (w > DEF_W) this.meta.cols.set(c, Math.min(w, 320)); }
      this.geoDirty = true;
      this.updateExtent();
    }
    autofitCol(c) {
      const ctx = this.canvas.getContext('2d');
      const used = this.usedSize();
      let w = 30;
      for (let r = 0; r < Math.min(used.rows, 5000); r++) {
        if (this.mergeAt.has(key(r, c))) continue;
        const t = this.display(r, c);
        if (!t) continue;
        ctx.font = this.fontOf(this.meta.styles.get(key(r, c)));
        w = Math.max(w, ctx.measureText(t).width / this.zoom + 10);
      }
      return Math.ceil(Math.min(w, 600));
    }

    // ------------------------------------------------------------ events
    pos(e) { const r = this.scroll.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    bind() {
      const sc = this.scroll;
      sc.addEventListener('scroll', () => { this.draw(); this.positionEditor(); });
      sc.addEventListener('mousedown', (e) => this.onDown(e));
      sc.addEventListener('mousemove', (e) => this.onHover(e));
      sc.addEventListener('dblclick', (e) => {
        const p = this.pos(e);
        if (p.y < HDR_H || p.x < HDR_W) {
          const b = this.borderAt(p);
          if (b && b.axis === 'c') { this.op(() => this.meta.cols.set(b.i, this.autofitCol(b.i)), { metaChange: true, hfChange: false }); this.geoDirty = true; this.updateExtent(); }
          return;
        }
        this.startEdit(null, true);
      });
      sc.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = this.pos(e);
        if (p.x > HDR_W && p.y > HDR_H) { const h = this.hit(p.x, p.y); const s = this.selRange(); if (h.r < s.r1 || h.r > s.r2 || h.c < s.c1 || h.c > s.c2) this.moveTo(h.r, h.c); }
        UI.menu(e.clientX, e.clientY, [
          { label: 'Вырезать', icon: 'x', key: 'Ctrl+X', onClick: () => document.execCommand('cut') },
          { label: 'Копировать', icon: 'copy', key: 'Ctrl+C', onClick: () => document.execCommand('copy') },
          { label: 'Вставить', icon: 'fileText', key: 'Ctrl+V', onClick: () => { sc.focus(); document.execCommand('paste'); } },
          '-',
          { label: 'Вставить строку выше', icon: 'up', onClick: () => this.insertRows(this.selRange().r1, 1) },
          { label: 'Вставить столбец слева', icon: 'outdent', onClick: () => this.insertCols(this.selRange().c1, 1) },
          { label: 'Удалить строки', icon: 'trash', onClick: () => this.deleteRows() },
          { label: 'Удалить столбцы', icon: 'trash', onClick: () => this.deleteCols() },
          '-',
          { label: 'Очистить содержимое', icon: 'eraser', key: 'Del', onClick: () => this.clearCells() },
          { label: 'Очистить форматы', icon: 'eraser', onClick: () => this.clearFormats() },
          { label: 'Объединить / разъединить', icon: 'table', onClick: () => this.toggleMerge() },
        ]);
      });
      sc.addEventListener('keydown', (e) => this.onKey(e));
      // IME / layouts whose keydown carries no printable key still deliver keypress
      sc.addEventListener('keypress', (e) => {
        const ch = e.key && e.key.length === 1 ? e.key : e.charCode >= 32 ? String.fromCharCode(e.charCode) : '';
        if (!this.editing && ch && !e.ctrlKey && !e.metaKey) { e.preventDefault(); this.startEdit(ch); }
      });
      const mine = () => !this.editing && document.activeElement === sc;
      this.onCopy = (e) => { if (mine()) this.copy(e, false); };
      this.onCut = (e) => { if (mine()) this.copy(e, true); };
      this.onPaste = (e) => { if (mine()) this.paste(e); };
      document.addEventListener('copy', this.onCopy);
      document.addEventListener('cut', this.onCut);
      document.addEventListener('paste', this.onPaste);
      // in-cell editor
      const ed = this.editor;
      ed.addEventListener('input', () => { this.lastRef = null; this.refPreview = null; this.fbar.value = ed.value; this.positionEditor(); this.draw(); });
      ed.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const p = ed.selectionStart; ed.value = ed.value.slice(0, p) + '\n' + ed.value.slice(ed.selectionEnd); ed.setSelectionRange(p + 1, p + 1); this.positionEditor(); return; }
        if (e.key === 'Enter') { e.preventDefault(); const { r, c } = this.editing; this.commitEdit(); this.moveTo(r + (e.shiftKey ? -1 : 1), c); }
        else if (e.key === 'Tab') { e.preventDefault(); const { r, c } = this.editing; this.commitEdit(); this.moveTo(r, c + (e.shiftKey ? -1 : 1)); }
        else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
        else if (e.key === 'F4' && ed.value[0] === '=') { e.preventDefault(); this.cycleAbsolute(); }
      });
      // formula bar
      this.fbar.addEventListener('focus', () => { if (!this.editing) { this.startEdit(null, true); this.fbar.focus(); } });
      this.fbar.addEventListener('input', () => { if (this.editing) { ed.value = this.fbar.value; this.positionEditor(); } });
      this.fbar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); const { r, c } = this.editing || this.sel; this.commitEdit(this.fbar.value); this.moveTo(r + 1, c); }
        if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
      });
      this.nameBox.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(this.nameBox.value.trim());
        if (!m) { toast('Введите адрес, например B12 или A1:C5', 'error'); return; }
        this.moveTo(+m[2] - 1, colIndex(m[1]));
        if (m[3]) this.moveTo(+m[4] - 1, colIndex(m[3]), true);
        this.scroll.focus();
      });
      this.fxBtn.addEventListener('click', () => {
        const r = this.fxBtn.getBoundingClientRect();
        const fns = [['СУММ', 'SUM', 'Сумма'], ['СРЗНАЧ', 'AVERAGE', 'Среднее'], ['СЧЁТ', 'COUNT', 'Количество чисел'], ['МИН', 'MIN', 'Минимум'], ['МАКС', 'MAX', 'Максимум'], ['ЕСЛИ', 'IF', 'Условие'], ['ВПР', 'VLOOKUP', 'Поиск в таблице'], ['СУММЕСЛИ', 'SUMIF', 'Сумма по условию'], ['СЧЁТЕСЛИ', 'COUNTIF', 'Количество по условию'], ['ОКРУГЛ', 'ROUND', 'Округление'], ['СЦЕП', 'CONCATENATE', 'Склеить текст'], ['СЕГОДНЯ', 'TODAY', 'Сегодняшняя дата']];
        UI.menu(r.left, r.bottom + 4, fns.map(([ru, en, d]) => ({ label: `${ru} — ${d}`, onClick: () => { if (!this.editing) this.startEdit('='); const ed2 = this.editor; const p = ed2.selectionStart; const ins = `${en}()`; ed2.value = ed2.value.slice(0, p) + ins + ed2.value.slice(p); ed2.setSelectionRange(p + ins.length - 1, p + ins.length - 1); this.fbar.value = ed2.value; this.positionEditor(); ed2.focus(); } })));
      });
    }
    cycleAbsolute() {
      const ed = this.editor;
      const p = ed.selectionStart;
      const left = ed.value.slice(0, p);
      const m = /(\$?)([A-Z]+)(\$?)(\d+)$/i.exec(left);
      if (!m) return;
      const states = [['', ''], ['$', '$'], ['', '$'], ['$', '']];
      const i = states.findIndex(([a, b]) => a === m[1] && b === m[3]);
      const [a, b] = states[(i + 1) % 4];
      const rep = `${a}${m[2]}${b}${m[4]}`;
      ed.value = left.slice(0, left.length - m[0].length) + rep + ed.value.slice(p);
      const np = p - m[0].length + rep.length;
      ed.setSelectionRange(np, np);
      this.fbar.value = ed.value;
    }
    borderAt(p) {
      if (p.y < HDR_H && p.x > HDR_W) {
        for (const c of this.visCols || []) { const x = this.sx(c + 1); if (Math.abs(p.x - x) <= 4) return { axis: 'c', i: c }; }
      }
      if (p.x < HDR_W && p.y > HDR_H) {
        for (const r of this.visRows || []) { const y = this.sy(r + 1); if (Math.abs(p.y - y) <= 3) return { axis: 'r', i: r }; }
      }
      return null;
    }
    onHover(e) {
      const p = this.pos(e);
      const b = this.borderAt(p);
      const hr = this.handleRect;
      const onHandle = hr && p.x >= hr.x && p.x <= hr.x + hr.w && p.y >= hr.y && p.y <= hr.y + hr.h;
      this.scroll.style.cursor = b ? (b.axis === 'c' ? 'col-resize' : 'row-resize') : onHandle ? 'crosshair' : p.x > HDR_W && p.y > HDR_H ? 'cell' : 'default';
    }
    onDown(e) {
      if (e.button !== 0) return;
      const p = this.pos(e);
      if (p.x > this.W || p.y > this.H) return; // scrollbars
      // formula reference picking
      if (this.editing && this.formulaRefMode() && p.x > HDR_W && p.y > HDR_H) {
        e.preventDefault();
        const a = this.hit(p.x, p.y);
        this.insertRef(a.r, a.c, a.r, a.c);
        const move = (m) => { const q = this.pos(m); const b = this.hit(q.x, q.y); this.insertRef(a.r, a.c, b.r, b.c); };
        const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.editor.focus(); };
        addEventListener('mousemove', move); addEventListener('mouseup', up);
        return;
      }
      if (this.editing) this.commitEdit();
      this.scroll.focus({ preventScroll: true });
      const b = this.borderAt(p);
      if (b) return this.resizeDrag(e, b);
      const hr = this.handleRect;
      if (hr && p.x >= hr.x && p.x <= hr.x + hr.w && p.y >= hr.y && p.y <= hr.y + hr.h) return this.fillDrag(e);
      if (p.y < HDR_H && p.x < HDR_W) { this.sel = { r: 0, c: 0, r2: this.nRows - 1, c2: this.nCols - 1 }; this.selectionChanged(); return; }
      const h = this.hit(p.x, p.y);
      if (p.y < HDR_H) { // column header
        if (e.shiftKey) this.sel.c2 = h.c; else this.sel = { r: 0, c: h.c, r2: this.nRows - 1, c2: h.c };
        this.selectionChanged();
        this.dragSelect(e, 'c');
        return;
      }
      if (p.x < HDR_W) {
        if (e.shiftKey) this.sel.r2 = h.r; else this.sel = { r: h.r, c: 0, r2: h.r, c2: this.nCols - 1 };
        this.selectionChanged();
        this.dragSelect(e, 'r');
        return;
      }
      if (e.shiftKey) { this.sel.r2 = h.r; this.sel.c2 = h.c; }
      else {
        const mg = this.mergeAt.get(key(h.r, h.c));
        this.sel = mg ? { r: mg[0], c: mg[1], r2: mg[2], c2: mg[3] } : { r: h.r, c: h.c, r2: h.r, c2: h.c };
      }
      this.selectionChanged();
      this.dragSelect(e, null);
    }
    dragSelect(e, mode) {
      let timer = null, last = null;
      const step = () => {
        if (!last) return;
        const q = last;
        if (q.y > this.H - 10) this.scroll.scrollTop += 20; else if (q.y < HDR_H + 5) this.scroll.scrollTop -= 20;
        if (q.x > this.W - 10) this.scroll.scrollLeft += 20; else if (q.x < HDR_W + 5) this.scroll.scrollLeft -= 20;
        const h = this.hit(Math.max(HDR_W + 1, q.x), Math.max(HDR_H + 1, q.y));
        if (mode !== 'r') this.sel.c2 = h.c;
        if (mode !== 'c') this.sel.r2 = h.r;
        if (mode === 'c') this.sel.r2 = this.nRows - 1;
        if (mode === 'r') this.sel.c2 = this.nCols - 1;
        this.selectionChanged();
      };
      const move = (m) => { last = this.pos(m); step(); };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); clearInterval(timer); };
      timer = setInterval(step, 60);
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    resizeDrag(e, b) {
      const start = b.axis === 'c' ? e.clientX : e.clientY;
      const orig = b.axis === 'c' ? this.colW(b.i) : this.rowH(b.i);
      const before = this.snapMeta();
      const move = (m) => {
        const d = ((b.axis === 'c' ? m.clientX : m.clientY) - start) / this.zoom;
        const v = Math.max(b.axis === 'c' ? 8 : 6, Math.round(orig + d));
        (b.axis === 'c' ? this.meta.cols : this.meta.rows).set(b.i, v);
        this.geoDirty = true;
        this.updateExtent();
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        this.undoStack.push({ steps: 0, before, after: this.snapMeta(), selBefore: { ...this.sel }, selAfter: { ...this.sel }, activeBefore: this.active, activeAfter: this.active });
        this.redoStack = [];
        this.onDirty();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    fillDrag() {
      const src = this.selRange();
      const move = (m) => {
        const q = this.pos(m);
        const h = this.hit(q.x, q.y);
        const dr = h.r > src.r2 ? h.r - src.r2 : h.r < src.r1 ? h.r - src.r1 : 0;
        const dc = h.c > src.c2 ? h.c - src.c2 : h.c < src.c1 ? h.c - src.c1 : 0;
        if (Math.abs(dr) >= Math.abs(dc)) this.fillPreview = { r1: Math.min(src.r1, src.r1 + Math.min(dr, 0)), c1: src.c1, r2: Math.max(src.r2, src.r2 + Math.max(dr, 0)), c2: src.c2 };
        else this.fillPreview = { r1: src.r1, c1: Math.min(src.c1, src.c1 + Math.min(dc, 0)), r2: src.r2, c2: Math.max(src.c2, src.c2 + Math.max(dc, 0)) };
        this.draw();
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        const f = this.fillPreview;
        this.fillPreview = null;
        if (f) this.fill(src, f); else this.draw();
      };
      addEventListener('mousemove', move);
      addEventListener('mouseup', up);
    }
    onKey(e) {
      if (this.editing) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const s = this.sel;
      const k = e.key;
      const used = this.usedSize();
      const nav = (dr, dc) => {
        e.preventDefault();
        let r = (e.shiftKey ? s.r2 : s.r), c = (e.shiftKey ? s.c2 : s.c);
        if (ctrl) {
          // jump to the edge of data, like Excel
          const filled = (rr, cc) => { const v = this.value(rr, cc); return v != null && v !== ''; };
          const cur = filled(r, c), nxt = filled(r + dr, c + dc);
          do { r += dr; c += dc; } while (r >= 0 && c >= 0 && r < Math.max(used.rows, 1) + 1 && c < Math.max(used.cols, 1) + 1 && (cur && nxt ? filled(r + dr, c + dc) : !filled(r, c)));
          r = Math.max(0, Math.min(r, Math.max(used.rows - 1, 0))); c = Math.max(0, Math.min(c, Math.max(used.cols - 1, 0)));
        } else { r += dr; c += dc; }
        this.moveTo(Math.max(0, r), Math.max(0, c), e.shiftKey);
      };
      if (ctrl && k.toLowerCase() === 'b') { e.preventDefault(); return this.toggleStyle('b'); }
      if (ctrl && k.toLowerCase() === 'i') { e.preventDefault(); return this.toggleStyle('i'); }
      if (ctrl && k.toLowerCase() === 'u') { e.preventDefault(); return this.toggleStyle('u'); }
      // with nothing selected in the DOM Chromium does not fire copy/cut by itself
      const isC = e.code === 'KeyC' || k.toLowerCase() === 'c' || k === 'с' || k === 'С', isX = e.code === 'KeyX' || k.toLowerCase() === 'x' || k === 'ч' || k === 'Ч';
      if (ctrl && !e.shiftKey && !e.altKey && (isC || isX)) { e.preventDefault(); document.execCommand(isX ? 'cut' : 'copy'); return; }
      if (ctrl && k.toLowerCase() === 'a') { e.preventDefault(); this.sel = { r: 0, c: 0, r2: Math.max(used.rows - 1, 0), c2: Math.max(used.cols - 1, 0) }; return this.selectionChanged(); }
      if (ctrl && k === 'Home') { e.preventDefault(); return this.moveTo(0, 0); }
      if (ctrl && k === 'End') { e.preventDefault(); return this.moveTo(Math.max(0, used.rows - 1), Math.max(0, used.cols - 1)); }
      if (e.altKey && (k === '=' || k === '+')) { e.preventDefault(); return this.autoSum(); }
      if (k === 'F3') { e.preventDefault(); return this.findNext(); }
      if (ctrl) return;
      switch (k) {
        case 'ArrowUp': return nav(-1, 0);
        case 'ArrowDown': return nav(1, 0);
        case 'ArrowLeft': return nav(0, -1);
        case 'ArrowRight': return nav(0, 1);
        case 'Tab': e.preventDefault(); return this.moveTo(s.r, s.c + (e.shiftKey ? -1 : 1));
        case 'Enter': e.preventDefault(); return this.moveTo(s.r + (e.shiftKey ? -1 : 1), s.c);
        case 'Home': e.preventDefault(); return this.moveTo(s.r, 0, e.shiftKey);
        case 'PageDown': e.preventDefault(); return this.moveTo(s.r + Math.floor(this.H / (DEF_H * this.zoom)), s.c, e.shiftKey);
        case 'PageUp': e.preventDefault(); return this.moveTo(s.r - Math.floor(this.H / (DEF_H * this.zoom)), s.c, e.shiftKey);
        case 'Delete': case 'Backspace': e.preventDefault(); if (k === 'Backspace') return this.startEdit(''); return this.clearCells();
        case 'F2': e.preventDefault(); return this.startEdit(null, true);
        case 'Escape': this.clip = null; return;
      }
      if (k.length === 1 && !e.altKey) { e.preventDefault(); this.startEdit(k); }
    }

    // ------------------------------------------------------------ editor API
    getData() {
      this.commitEdit();
      const sheets = this.metas.map((m) => {
        const raw = this.hf.getSheetSerialized(m.id);
        const vals = this.hf.getSheetValues(m.id);
        const cells = {};
        raw.forEach((row, r) => row.forEach((x, c) => {
          if (x == null || x === '') return;
          let v = vals[r] && vals[r][c];
          if (v && typeof v === 'object') v = v.value; // error -> '#DIV/0!'
          const cd = {};
          if (typeof x === 'string' && x[0] === '=') { cd.f = x; cd.v = v === undefined ? null : v; }
          else cd.v = v;
          cd.text = formatValue(vals[r] && vals[r][c], m.styles.get(key(r, c)) && m.styles.get(key(r, c)).fmt); // for CSV
          cells[key(r, c)] = cd;
        }));
        for (const [k, st] of m.styles) { if (cells[k]) cells[k].s = st; else cells[k] = { v: null, s: st }; }
        return {
          name: this.hf.getSheetName(m.id), cells,
          cols: Object.fromEntries(m.cols), rows: Object.fromEntries(m.rows),
          merges: m.merges.map((x) => x.slice()), freeze: m.freeze.rows || m.freeze.cols ? { ...m.freeze } : null,
        };
      });
      return { model: { sheets, active: this.active } };
    }
    // ------------------------------------------------------------ print / PDF
    /** one sheet (or a range of it) as an HTML table that looks like the grid */
    sheetHtml(m, range, grid) {
      const used = this.usedSize(m);
      const r1 = range ? range.r1 : 0, c1 = range ? range.c1 : 0;
      const r2 = range ? Math.min(range.r2, used.rows - 1) : used.rows - 1, c2 = range ? Math.min(range.c2, used.cols - 1) : used.cols - 1;
      if (r2 < r1 || c2 < c1) return { html: '', width: 0 };
      const merges = new Map(), covered = new Set();
      for (const g of m.merges) {
        if (g[0] > r2 || g[2] < r1 || g[1] > c2 || g[3] < c1) continue;
        merges.set(key(g[0], g[1]), g);
        for (let r = g[0]; r <= g[2]; r++) for (let c = g[1]; c <= g[3]; c++) if (r !== g[0] || c !== g[1]) covered.add(key(r, c));
      }
      let width = 0;
      let html = '<table class="os-sheet"><colgroup>';
      for (let c = c1; c <= c2; c++) { const w = this.colW(c, m); width += w; html += `<col style="width:${w}px">`; }
      html += '</colgroup>';
      const bd = (b) => (b ? `${/thick/.test(b.s) ? 2.5 : /medium/.test(b.s) ? 1.8 : 1}px ${/dash/.test(b.s) ? 'dashed' : /dot/.test(b.s) ? 'dotted' : 'solid'} ${b.c || '#000'}` : '');
      for (let r = r1; r <= r2; r++) {
        html += `<tr style="height:${this.rowH(r, m)}px">`;
        for (let c = c1; c <= c2; c++) {
          const k = key(r, c);
          if (covered.has(k)) continue;
          const g = merges.get(k);
          const st = m.styles.get(k) || {};
          const v = this.value(r, c, m);
          const isNum = typeof v === 'number';
          const css = [];
          if (st.b) css.push('font-weight:bold');
          if (st.i) css.push('font-style:italic');
          if (st.u || st.st) css.push(`text-decoration:${[st.u && 'underline', st.st && 'line-through'].filter(Boolean).join(' ')}`);
          if (st.size) css.push(`font-size:${st.size}pt`);
          if (st.font) css.push(`font-family:'${st.font}',Calibri,Carlito,Arial,sans-serif`);
          if (st.color) css.push(`color:${st.color}`);
          if (st.bg) css.push(`background:${st.bg}`);
          css.push(`text-align:${st.h || (isNum ? 'right' : typeof v === 'boolean' || (v && typeof v === 'object') ? 'center' : 'left')}`);
          css.push(`vertical-align:${st.v === 'top' ? 'top' : st.v === 'middle' ? 'middle' : 'bottom'}`);
          if (st.wrap) css.push('white-space:pre-wrap'); else css.push('white-space:nowrap');
          if (st.bd) for (const [side, name] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) if (st.bd[side]) css.push(`border-${name}:${bd(st.bd[side])}`);
          const span = g ? ` rowspan="${Math.min(g[2], r2) - r + 1}" colspan="${Math.min(g[3], c2) - c + 1}"` : '';
          html += `<td${span} style="${css.join(';')}">${UI.esc(this.display(r, c, m))}</td>`;
        }
        html += '</tr>';
      }
      html += '</table>';
      void grid;
      return { html, width };
    }
    async printOptions(title) {
      const s = this.selRange();
      const hasSel = s.r2 > s.r1 || s.c2 > s.c1;
      return modal({
        title,
        fields: [
          { name: 'what', label: 'Что печатать', type: 'select', options: [['sheet', 'Текущий лист'], ['all', 'Все листы'], ...(hasSel ? [['sel', `Выделенный диапазон (${addr(s.r1, s.c1)}:${addr(s.r2, s.c2)})`]] : [])], value: 'sheet' },
          { name: 'orient', label: 'Ориентация', type: 'select', options: [['port', 'Книжная (A4)'], ['land', 'Альбомная (A4)']], value: this.usedSize().cols > 8 ? 'land' : 'port' },
          { name: 'fit', label: 'Масштаб', type: 'select', options: [['width', 'Вписать по ширине страницы'], ['100', 'Без масштабирования (100%)']], value: 'width' },
          { name: 'grid', label: 'Сетка', type: 'select', options: [['1', 'Печатать линии сетки'], ['0', 'Без сетки (только границы)']], value: '1' },
        ],
        okText: 'Продолжить',
      });
    }
    async printPayload(title) {
      this.commitEdit();
      const o = await this.printOptions(title);
      if (!o) return null;
      const land = o.orient === 'land';
      const pw = land ? 297 : 210, ph = land ? 210 : 297, margin = 12;
      const usablePx = ((pw - 2 * margin) / 25.4) * 96;
      const sheets = o.what === 'all' ? this.metas : [this.meta];
      const parts = [];
      for (const m of sheets) {
        const { html, width } = this.sheetHtml(m, o.what === 'sel' ? this.selRange() : null, o.grid === '1');
        if (!html) continue;
        const k = o.fit === 'width' && width > usablePx ? usablePx / width : 1;
        const name = this.hf.getSheetName(m.id);
        parts.push(`<section class="os-sp">${sheets.length > 1 ? `<div class="os-sn">${UI.esc(name)}</div>` : ''}<div style="zoom:${k}">${html}</div></section>`);
      }
      if (!parts.length) { toast('На листе нет данных для печати'); return null; }
      const css = `body { font: 11pt Calibri, Carlito, 'Segoe UI', Arial, sans-serif; color: #000; }
        .os-sp { break-after: page; } .os-sp:last-child { break-after: auto; }
        .os-sn { font-weight: 600; font-size: 12pt; margin: 0 0 6px; }
        table.os-sheet { border-collapse: collapse; table-layout: fixed; }
        table.os-sheet td { padding: 1px 3px; overflow: hidden; text-overflow: clip; ${o.grid === '1' ? 'border: 1px solid #d0d4da;' : ''} }
        tr { break-inside: avoid; }`;
      return { html: parts.join(''), css, widthMm: pw, heightMm: ph, marginMm: margin, suggestedName: (window.App && App.active() && App.active().name) || 'Таблица' };
    }
    async exportMenu() {
      const p = await this.printPayload('Сохранить в PDF');
      if (!p) return;
      const r = await window.api.printHtml({ ...p, action: 'pdf' });
      if (r.ok) toast('PDF сохранён: ' + r.path.split(/[\\/]/).pop());
      else if (!r.canceled) toast('Ошибка экспорта: ' + r.error, 'error');
    }
    async printPreview() {
      const p = await this.printPayload('Печать');
      if (!p) return;
      const r = await window.api.printHtml({ ...p, action: 'preview' });
      if (!r.ok && !r.canceled) toast('Ошибка печати: ' + r.error, 'error');
    }
    onActivate() { requestAnimationFrame(() => { this.layout(); this.scroll.focus({ preventScroll: true }); }); }
    destroy() { this.ro.disconnect(); document.removeEventListener('copy', this.onCopy); document.removeEventListener('cut', this.onCut); document.removeEventListener('paste', this.onPaste); try { this.hf.destroy(); } catch {} }
  }

  window.SheetEditor = SheetEditor;
  window.SheetFormat = { formatValue, parseInput, normalizeFormula };
})();
