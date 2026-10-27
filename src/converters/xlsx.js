// XLSX / CSV <-> spreadsheet model (Electron main process / Node).
// Model: { sheets: [{ name, cells: { "r:c": { v, f, s } }, cols: {c: px}, rows: {r: px}, merges: [[r1,c1,r2,c2]], freeze: {rows, cols} }], active }
//   v = value (number | string | boolean | null), f = formula text starting with "=", s = style object (see below)
// Style: { b, i, u, st, size, font, color, bg, h, v, wrap, fmt, bd: { t, r, b, l } }  (all optional)
const ExcelJS = require('exceljs');

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const dateToSerial = (d) => (d.getTime() - EXCEL_EPOCH) / 86400000;

// Office 2013+ default theme colours (index order used by Excel: lt1, dk1, lt2, dk2, accent1..6)
const THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47', '0563C1', '954F72'];
const INDEXED = { 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 14: 'FF00FF', 15: '00FFFF', 16: '800000', 17: '008000', 18: '000080', 19: '808000', 20: '800080', 21: '008080', 22: 'C0C0C0', 23: '808080', 64: '000000' };

function tint(hex, t) {
  if (!t) return hex;
  const n = parseInt(hex, 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (t < 0 ? v * (1 + t) : v + (255 - v) * t));
  return ch.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}
function colorOf(c) {
  if (!c) return null;
  if (c.argb) {
    const a = c.argb.length === 8 ? c.argb.slice(2) : c.argb;
    return '#' + a.toLowerCase();
  }
  if (c.theme != null && THEME[c.theme]) return '#' + tint(THEME[c.theme], c.tint).toLowerCase();
  if (c.indexed != null && INDEXED[c.indexed]) return '#' + INDEXED[c.indexed].toLowerCase();
  return null;
}
const argb = (hex) => ({ argb: 'FF' + hex.replace('#', '').toUpperCase() });

function styleOf(cell) {
  const s = {};
  const f = cell.font || {};
  if (f.bold) s.b = 1;
  if (f.italic) s.i = 1;
  if (f.underline) s.u = 1;
  if (f.strike) s.st = 1;
  if (f.size && f.size !== 11) s.size = f.size;
  if (f.name && !/^calibri$/i.test(f.name)) s.font = f.name;
  const fc = colorOf(f.color);
  if (fc && fc !== '#000000') s.color = fc;
  const fill = cell.fill;
  if (fill && fill.type === 'pattern' && fill.pattern && fill.pattern !== 'none') {
    const bg = colorOf(fill.fgColor) || colorOf(fill.bgColor);
    if (bg) s.bg = bg;
  }
  const a = cell.alignment || {};
  if (a.horizontal && a.horizontal !== 'general') s.h = a.horizontal === 'centerContinuous' ? 'center' : a.horizontal;
  if (a.vertical) s.v = a.vertical === 'middle' ? 'middle' : a.vertical;
  if (a.wrapText) s.wrap = 1;
  if (cell.numFmt && cell.numFmt !== 'General') s.fmt = cell.numFmt;
  const b = cell.border;
  if (b) {
    const bd = {};
    for (const [k, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) {
      if (b[side] && b[side].style) bd[k] = { s: b[side].style, c: colorOf(b[side].color) || '#000000' };
    }
    if (Object.keys(bd).length) s.bd = bd;
  }
  return Object.keys(s).length ? s : null;
}

function plain(v) {
  if (v && typeof v === 'object' && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
  if (v && typeof v === 'object' && v.text != null) return String(v.text);
  return v;
}

const colIndex = (letters) => letters.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
function parseRef(ref) {
  const m = /^\$?([A-Z]+)\$?(\d+)$/i.exec(ref);
  return m ? [parseInt(m[2], 10) - 1, colIndex(m[1])] : null;
}

async function xlsxToModel(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const sh = { name: ws.name, cells: {}, cols: {}, rows: {}, merges: [], freeze: null };
    ws.eachRow({ includeEmpty: false }, (row, rn) => {
      if (row.height && Math.abs(row.height - 15) > 0.5) sh.rows[rn - 1] = Math.round((row.height * 96) / 72);
      row.eachCell({ includeEmpty: true }, (cell, cn) => {
        const out = {};
        let v = cell.value;
        if (cell.type === ExcelJS.ValueType.Merge) return; // covered by a merge: content lives in the master cell
        if (v && typeof v === 'object' && (v.formula != null || v.sharedFormula != null)) {
          const formula = cell.formula; // ExcelJS translates shared formulas for each cell
          if (formula) out.f = '=' + formula;
          let r = v.result;
          if (r instanceof Date) r = dateToSerial(r);
          if (r && typeof r === 'object' && r.error) r = r.error;
          out.v = r === undefined ? null : plain(r);
        } else if (v instanceof Date) {
          out.v = dateToSerial(v);
        } else if (v && typeof v === 'object' && v.error) {
          out.v = v.error;
        } else {
          out.v = v === undefined ? null : plain(v);
        }
        const s = styleOf(cell);
        if (s) out.s = s;
        if (v instanceof Date && !(s && s.fmt)) out.s = { ...(out.s || {}), fmt: 'dd.mm.yyyy' };
        if (out.v == null && !out.f && !out.s) return;
        sh.cells[`${rn - 1}:${cn - 1}`] = out;
      });
    });
    (ws.columns || []).forEach((col, i) => {
      if (col && col.width && Math.abs(col.width - 8.43) > 0.2) sh.cols[i] = Math.round(col.width * 7 + 5);
    });
    for (const m of ws.model.merges || []) {
      const [a, b] = m.split(':');
      const p = parseRef(a), q = parseRef(b || a);
      if (p && q) sh.merges.push([p[0], p[1], q[0], q[1]]);
    }
    const view = (ws.views || [])[0];
    if (view && view.state === 'frozen' && (view.xSplit || view.ySplit)) sh.freeze = { rows: view.ySplit || 0, cols: view.xSplit || 0 };
    sheets.push(sh);
  });
  if (!sheets.length) sheets.push({ name: 'Лист1', cells: {}, cols: {}, rows: {}, merges: [], freeze: null });
  return { sheets, active: Math.max(0, (wb.views && wb.views[0] && wb.views[0].activeTab) || 0) };
}

// ------------------------------------------------------------------ writing
function applyStyle(cell, s) {
  if (!s) return;
  const font = {};
  if (s.b) font.bold = true;
  if (s.i) font.italic = true;
  if (s.u) font.underline = true;
  if (s.st) font.strike = true;
  font.size = s.size || 11;
  font.name = s.font || 'Calibri';
  if (s.color) font.color = argb(s.color);
  cell.font = font;
  if (s.bg) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: argb(s.bg) };
  if (s.h || s.v || s.wrap) cell.alignment = { horizontal: s.h, vertical: s.v, wrapText: !!s.wrap };
  if (s.fmt) cell.numFmt = s.fmt;
  if (s.bd) {
    const b = {};
    for (const [k, side] of [['t', 'top'], ['r', 'right'], ['b', 'bottom'], ['l', 'left']]) if (s.bd[k]) b[side] = { style: s.bd[k].s || 'thin', color: argb(s.bd[k].c || '#000000') };
    cell.border = b;
  }
}

async function modelToXlsx(model) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OfficeStudio';
  wb.created = new Date();
  for (const sh of model.sheets) {
    const views = sh.freeze && (sh.freeze.rows || sh.freeze.cols) ? [{ state: 'frozen', xSplit: sh.freeze.cols || 0, ySplit: sh.freeze.rows || 0 }] : [];
    const ws = wb.addWorksheet(sh.name, { views });
    for (const [c, px] of Object.entries(sh.cols || {})) ws.getColumn(+c + 1).width = Math.max(0.5, (px - 5) / 7);
    for (const [r, px] of Object.entries(sh.rows || {})) ws.getRow(+r + 1).height = (px * 72) / 96;
    for (const [key, cd] of Object.entries(sh.cells)) {
      const [r, c] = key.split(':').map(Number);
      const cell = ws.getCell(r + 1, c + 1);
      if (cd.f) {
        let result = cd.v;
        if (typeof result === 'string' && /^#[A-Z/0!?]+[!?A-Z0]*$/.test(result)) result = { error: result };
        cell.value = { formula: cd.f.replace(/^=/, ''), result: result == null ? undefined : result };
      } else if (cd.v != null && cd.v !== '') {
        cell.value = cd.v;
      }
      applyStyle(cell, cd.s);
    }
    for (const [r1, c1, r2, c2] of sh.merges || []) {
      try { ws.mergeCells(r1 + 1, c1 + 1, r2 + 1, c2 + 1); } catch {}
    }
  }
  wb.views = [{ activeTab: model.active || 0 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ CSV
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', '\t', ','].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const cells = {};
  rows.forEach((r, ri) => r.forEach((v, ci) => {
    if (v === '') return;
    const num = v.trim().replace(/\s/g, '').replace(',', '.');
    cells[`${ri}:${ci}`] = { v: /^[-+]?\d+(\.\d+)?$/.test(num) ? parseFloat(num) : v };
  }));
  return { sheets: [{ name: 'Лист1', cells, cols: {}, rows: {}, merges: [], freeze: null }], active: 0, csv: true };
}
function modelToCsv(model) {
  const sh = model.sheets[model.active || 0];
  let maxR = -1, maxC = -1;
  for (const k of Object.keys(sh.cells)) { const [r, c] = k.split(':').map(Number); maxR = Math.max(maxR, r); maxC = Math.max(maxC, c); }
  const lines = [];
  for (let r = 0; r <= maxR; r++) {
    const row = [];
    for (let c = 0; c <= maxC; c++) {
      const cd = sh.cells[`${r}:${c}`];
      let v = cd ? (cd.text != null ? cd.text : cd.v) : '';
      v = v == null ? '' : String(v);
      if (/[;"\n\r]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
      row.push(v);
    }
    lines.push(row.join(';'));
  }
  // BOM so Excel opens UTF-8 Cyrillic correctly; ";" is the Excel list separator for Russian locales
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8');
}

module.exports = { xlsxToModel, modelToXlsx, parseCsv, modelToCsv };
