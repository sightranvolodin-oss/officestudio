const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const { docxToHtml, htmlToDocx } = require('./converters/docx');
const { pptxToModel } = require('./converters/pptx-read');
const { modelToPptx } = require('./converters/pptx-write');
const { cadFileToDxf, cadFileToFullDxf } = require('./converters/cad');
const { setupUpdater } = require('./updater');
const { xlsxToModel, modelToXlsx, parseCsv, modelToCsv } = require('./converters/xlsx');

let win = null;
let forceQuit = false;
const pendingOpen = [];

// ------------------------------------------------------------------ app files over os://app/
// The window and the embedded editors (WordCraft, GridCraft, DeckCraft, CADCraft — web builds,
// MIT OR Apache-2.0, github.com/storytold) are served from one secure origin, so the editors can
// talk to OfficeStudio through postMessage and use WebGPU, the clipboard and local storage.
protocol.registerSchemesAsPrivileged([{ scheme: 'os', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const RENDERER_ROOT = path.join(__dirname, 'renderer');
const CRAFTS_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'crafts') : path.join(__dirname, '..', 'crafts');
const CRAFT_BY_KIND = { doc: 'wordcraft', sheet: 'gridcraft', slides: 'deckcraft', cad: 'cadcraft' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8' };
function serveApp(req) {
  let p;
  try { p = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response('bad request', { status: 400 }); }
  let root = RENDERER_ROOT;
  if (p.startsWith('/crafts/')) { root = CRAFTS_ROOT; p = p.slice('/crafts'.length); }
  if (p.endsWith('/')) p += 'index.html';
  const f = path.normalize(path.join(root, p));
  if (f !== root && !f.startsWith(root + path.sep)) return new Response('forbidden', { status: 403 });
  return fs.promises.readFile(f).then(
    (data) => new Response(data, { headers: { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' } }),
    () => new Response('not found', { status: 404 }),
  );
}
/** the embedded editors that are installed: { doc: true, … } */
function craftsInstalled() {
  const out = {};
  for (const [kind, name] of Object.entries(CRAFT_BY_KIND)) out[kind] = fs.existsSync(path.join(CRAFTS_ROOT, name, 'index.html'));
  return out;
}

// ------------------------------------------------------------------ settings
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function getSettings() {
  let s = { editors: 'craft' };
  try { s = { ...s, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
  if (process.env.OS_EDITORS) s.editors = process.env.OS_EDITORS; // automated tests
  return s;
}
function setSettings(patch) {
  const s = { ...getSettings(), ...patch };
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s)); } catch {}
  return s;
}

// ------------------------------------------------------------------ recent files
const recentFile = () => path.join(app.getPath('userData'), 'recent.json');
function getRecent() {
  try { return JSON.parse(fs.readFileSync(recentFile(), 'utf8')).filter((p) => fs.existsSync(p)); } catch { return []; }
}
function addRecent(p) {
  const list = [p, ...getRecent().filter((x) => x !== p)].slice(0, 12);
  try { fs.writeFileSync(recentFile(), JSON.stringify(list)); } catch {}
  app.addRecentDocument && app.addRecentDocument(p);
}

// ------------------------------------------------------------------ file types
const KIND_BY_EXT = { '.docx': 'doc', '.html': 'doc', '.htm': 'doc', '.txt': 'doc', '.md': 'doc', '.pptx': 'slides', '.dwg': 'cad', '.dxf': 'cad', '.xlsx': 'sheet', '.xlsm': 'sheet', '.csv': 'sheet' };
// what the embedded editors open on top of that
const CRAFT_EXT = { '.doc': 'doc', '.docm': 'doc', '.dotx': 'doc', '.odt': 'doc', '.rtf': 'doc', '.xlsb': 'sheet', '.ods': 'sheet', '.xltx': 'sheet', '.potx': 'slides', '.ppsx': 'slides' };
const kindOf = (ext) => KIND_BY_EXT[ext] || CRAFT_EXT[ext] || null;
const FILTERS = {
  doc: [{ name: 'Документ Word', extensions: ['docx'] }, { name: 'Веб-страница', extensions: ['html'] }],
  slides: [{ name: 'Презентация PowerPoint', extensions: ['pptx'] }],
  cad: [{ name: 'Чертёж DXF (открывается в AutoCAD)', extensions: ['dxf'] }],
  sheet: [{ name: 'Книга Excel', extensions: ['xlsx'] }, { name: 'CSV (разделитель «;», UTF-8)', extensions: ['csv'] }],
};
const OPEN_FILTERS = [
  { name: 'Все поддерживаемые', extensions: ['docx', 'doc', 'odt', 'rtf', 'xlsx', 'xlsm', 'xlsb', 'ods', 'csv', 'pptx', 'potx', 'ppsx', 'dwg', 'dxf', 'txt', 'html', 'htm', 'md'] },
  { name: 'Документы Word', extensions: ['docx', 'doc', 'odt', 'rtf'] },
  { name: 'Таблицы Excel', extensions: ['xlsx', 'xlsm', 'xlsb', 'ods', 'csv'] },
  { name: 'Презентации PowerPoint', extensions: ['pptx', 'potx', 'ppsx'] },
  { name: 'Чертежи AutoCAD', extensions: ['dwg', 'dxf'] },
  { name: 'Текст', extensions: ['txt', 'html', 'htm', 'md'] },
];

const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function openPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const name = path.basename(filePath);
  if (ext === '.doc' || ext === '.ppt' || ext === '.xls') {
    throw new Error(`Старый двоичный формат ${ext} (Office 97–2003) не поддерживается. Откройте файл в Word/Excel/PowerPoint или LibreOffice и сохраните как ${ext}x.`);
  }
  const kind = KIND_BY_EXT[ext];
  if (!kind) throw new Error(`Формат ${ext || '(без расширения)'} не поддерживается`);
  const buf = fs.readFileSync(filePath);
  let payload;
  if (kind === 'doc') {
    if (ext === '.docx') payload = await docxToHtml(buf);
    else if (ext === '.txt' || ext === '.md') payload = { html: buf.toString('utf8').split(/\r?\n/).map((l) => `<p>${escHtml(l) || '<br>'}</p>`).join(''), warnings: [] };
    else {
      const raw = buf.toString('utf8');
      const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(raw);
      payload = { html: body ? body[1] : raw, warnings: [] };
    }
  } else if (kind === 'slides') {
    payload = { model: await pptxToModel(buf) };
  } else if (kind === 'sheet') {
    if (ext === '.csv') {
      let text = buf.toString('utf8');
      // not valid UTF-8 -> most likely a Windows-1251 export from Russian Excel
      if (text.includes('\uFFFD')) text = new TextDecoder('windows-1251').decode(buf);
      payload = { model: parseCsv(text) };
    } else payload = { model: await xlsxToModel(buf) };
  } else {
    payload = { dxf: new Uint8Array(await cadFileToDxf(buf, filePath)) };
  }
  // DWG can be read but not written: saving goes to a sibling .dxf
  const savePath = ext === '.dwg' || ext === '.xlsm' || (kind === 'doc' && ext !== '.docx' && ext !== '.html' && ext !== '.htm') ? null : filePath;
  addRecent(filePath);
  return { kind, name, path: filePath, savePath, sourceExt: ext, ...payload };
}

async function serialize(kind, data, targetPath) {
  const ext = path.extname(targetPath).toLowerCase();
  if (kind === 'doc') {
    if (ext === '.html' || ext === '.htm') {
      return Buffer.from(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escHtml(path.basename(targetPath))}</title></head><body>${data.htmlInline || data.html}</body></html>`, 'utf8');
    }
    return htmlToDocx(data.html, { title: path.basename(targetPath, ext) }, data.inks || [], data.doc || null);
  }
  if (kind === 'slides') return modelToPptx({ ...data.model, title: path.basename(targetPath, ext) });
  if (kind === 'cad') return Buffer.from(data.dxf);
  if (kind === 'sheet') return ext === '.csv' ? modelToCsv(data.model) : modelToXlsx(data.model);
  throw new Error('Неизвестный тип документа');
}

// ------------------------------------------------------------------ IPC
ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Открыть файл', properties: ['openFile', 'multiSelections'], filters: OPEN_FILTERS });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('open-file', async (e, filePath) => {
  try { return { ok: true, doc: await openPath(filePath) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
});

ipcMain.handle('save-file', async (e, { kind, data, path: current, saveAs, suggestedName }) => {
  try {
    let target = current;
    if (!target || saveAs) {
      const ext = FILTERS[kind][0].extensions[0];
      const base = (suggestedName || 'Без имени').replace(/\.[^.]+$/, '');
      const dir = current ? path.dirname(current) : app.getPath('documents');
      const r = await dialog.showSaveDialog(win, { title: 'Сохранить как', defaultPath: path.join(dir, `${base}.${ext}`), filters: FILTERS[kind] });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      target = r.filePath;
    }
    const buf = await serialize(kind, data, target);
    fs.writeFileSync(target, buf);
    addRecent(target);
    return { ok: true, path: target, name: path.basename(target) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});

// ------------------------------------------------------------------ embedded editors
ipcMain.handle('settings-get', () => ({ ...getSettings(), crafts: craftsInstalled() }));
ipcMain.handle('settings-set', (e, patch) => ({ ...setSettings(patch), crafts: craftsInstalled() }));
/** reads a file for an embedded editor; DWG becomes DXF (CADCraft's web build reads DXF) */
ipcMain.handle('craft-open', async (e, filePath) => {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const kind = kindOf(ext);
    if (!kind) throw new Error(`Формат ${ext || '(без расширения)'} не поддерживается`);
    let bytes = fs.readFileSync(filePath);
    let sendName = path.basename(filePath);
    let savePath = filePath;
    if (kind === 'cad') {
      bytes = await cadFileToFullDxf(bytes, filePath);
      if (ext === '.dwg') { sendName = sendName.replace(/\.dwg$/i, '.dxf'); savePath = null; }
    }
    addRecent(filePath);
    return { ok: true, doc: { kind, app: CRAFT_BY_KIND[kind], name: path.basename(filePath), sendName, path: filePath, savePath, sourceExt: ext, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.length) } };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
/**
 * a file an embedded editor hands over (Save, Save As, exports). `target` is the tab's own file:
 * written in place when the editor saves under the same name; otherwise the user picks the place.
 */
ipcMain.handle('craft-save', async (e, { target, name, bytes, saveAs, dir }) => {
  try {
    let file = target && !saveAs && path.basename(target).toLowerCase() === String(name || '').toLowerCase() ? target : null;
    if (!file) {
      const ext = path.extname(name || '').slice(1).toLowerCase();
      const base = path.join(dir || (target && path.dirname(target)) || app.getPath('documents'), path.basename(name || 'Без имени'));
      const r = process.env.OS_TEST_SAVE_DIR ? { filePath: path.join(process.env.OS_TEST_SAVE_DIR, path.basename(name)) } : await dialog.showSaveDialog(win, { title: /^(pdf|png|svg|jpe?g)$/.test(ext) ? 'Экспорт' : 'Сохранить как', defaultPath: base, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: 'Все файлы', extensions: ['*'] }] : undefined });
      if (r.canceled || !r.filePath) return { ok: false, canceled: true };
      file = r.filePath;
    }
    fs.writeFileSync(file, Buffer.from(bytes));
    if (kindOf(path.extname(file).toLowerCase())) addRecent(file);
    return { ok: true, path: file, name: path.basename(file) };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
// Windows fonts for WordCraft: its browser build only knows the fonts it ships (no Cambria Math,
// so equation symbols such as ⋅ come out as boxes) and the fonts kept in its own storage. The
// common Office fonts of this computer are handed to it (they never leave the computer).
const OFFICE_FONTS = [
  'cambria.ttc', 'cambriab.ttf', 'cambriai.ttf', 'cambriaz.ttf',
  'calibri.ttf', 'calibrib.ttf', 'calibrii.ttf', 'calibriz.ttf', 'calibril.ttf', 'calibrili.ttf',
  'times.ttf', 'timesbd.ttf', 'timesi.ttf', 'timesbi.ttf',
  'arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf',
  'seguisym.ttf', 'segoeui.ttf', 'segoeuib.ttf', 'segoeuii.ttf', 'symbol.ttf', 'consola.ttf',
];
function officeFontFiles() {
  if (process.env.OS_FONTS_DIR) { // automated tests
    const d = process.env.OS_FONTS_DIR;
    return fs.readdirSync(d).filter((n) => /\.(ttf|otf|ttc|otc)$/i.test(n)).map((n) => path.join(d, n));
  }
  if (process.platform !== 'win32') return [];
  const dirs = [path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'), process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts')].filter(Boolean);
  const out = [];
  for (const n of OFFICE_FONTS) {
    const f = dirs.map((d) => path.join(d, n)).find((x) => { try { return fs.statSync(x).size < 50 * 1024 * 1024; } catch { return false; } });
    if (f) out.push(f);
  }
  return out;
}
/** fonts not yet given to WordCraft: [{ name, bytes }] (`have`: the names it already keeps) */
ipcMain.handle('office-fonts', (e, have) => {
  const known = new Set((have || []).map((n) => String(n).toLowerCase()));
  const out = [];
  for (const f of officeFontFiles()) {
    const name = 'os-' + path.basename(f).toLowerCase();
    if (known.has(name)) continue;
    try { out.push({ name, bytes: new Uint8Array(fs.readFileSync(f)) }); } catch {}
  }
  return out;
});

// pencil marks drawn over a tab, remembered per file
const annotFile = () => path.join(app.getPath('userData'), 'annotations.json');
function readAnnots() { try { return JSON.parse(fs.readFileSync(annotFile(), 'utf8')); } catch { return {}; } }
ipcMain.handle('annot-get', (e, key) => readAnnots()[key] || null);
ipcMain.handle('annot-set', (e, key, value) => {
  const all = readAnnots();
  if (value && value.strokes && value.strokes.length) all[key] = value; else delete all[key];
  try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(annotFile(), JSON.stringify(all)); } catch {}
  return true;
});
// a part of the window (a tab with its pencil marks) as a PNG
ipcMain.handle('save-screenshot', async (e, { rect, suggestedName }) => {
  try {
    const img = await win.webContents.capturePage(rect);
    const r = process.env.OS_TEST_SAVE_DIR ? { filePath: path.join(process.env.OS_TEST_SAVE_DIR, 'annot.png') } : await dialog.showSaveDialog(win, { title: 'Сохранить снимок с пометками', defaultPath: path.join(app.getPath('pictures'), (suggestedName || 'Пометки') + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(r.filePath, img.toPNG());
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
});
ipcMain.handle('set-menu-mode', (e, mode) => { if (mode !== menuMode) { menuMode = mode; menu(); } });

// Document -> PDF with the page size, margins, headers/footers and page numbers of the document.
// action 'pdf' asks where to save; 'preview' opens the PDF in a window with a print button.
ipcMain.handle('export-pdf', async (e, { html, css, doc, suggestedName, action = 'pdf' }) => {
  const pg = { w: 210, h: 297, mt: 25.4, mb: 25.4, ml: 23.8, mr: 23.8, ...((doc && doc.page) || {}) };
  let target = null;
  if (action === 'pdf' && process.env.OS_TEST_PDF) target = process.env.OS_TEST_PDF; // automated tests
  else if (action === 'pdf') {
    const r = await dialog.showSaveDialog(win, { title: 'Экспорт в PDF', defaultPath: path.join(app.getPath('documents'), (suggestedName || 'Документ').replace(/\.[^.]+$/, '') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    target = r.filePath;
  }
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  try {
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: ${pg.w}mm ${pg.h}mm; margin: ${pg.mt}mm ${pg.mr}mm ${pg.mb}mm ${pg.ml}mm; }
      html, body { margin: 0; padding: 0; }
      body { font-family: Calibri, Carlito, 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.38; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      ${css || 'table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;vertical-align:top}img{max-width:100%}'}
      body { padding: 0 !important; width: auto !important; min-height: 0 !important; box-shadow: none !important; background: #fff !important; }
      .page-break { page-break-after: always; break-after: page; height: 0; border: 0 !important; margin: 0 !important; }
      .page-break::after { content: none !important; }
      tr, img, p, li, h1, h2, h3, h4, blockquote { break-inside: avoid; }
      h1, h2, h3, h4 { break-after: avoid; }
    </style></head><body>${html}</body></html>`;
    await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    const esc = (t) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tpl = (text, align, pad) => {
      if (!text) return '<span></span>';
      const t = esc(text).replace(/\{PAGE\}/g, '<span class="pageNumber"></span>').replace(/\{NUMPAGES\}/g, '<span class="totalPages"></span>').replace(/\n/g, '<br>');
      return `<div style="width:100%;box-sizing:border-box;padding:0 ${pg.mr}mm 0 ${pg.ml}mm;font:9pt Calibri,Carlito,Arial,sans-serif;color:#444;text-align:${align || 'center'};-webkit-print-color-adjust:exact;${pad}">${t}</div>`;
    };
    const hasHF = !!(doc && (doc.header || doc.footer));
    const pdf = await pw.webContents.printToPDF({
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: hasHF,
      headerTemplate: tpl(doc && doc.header, doc && doc.headerAlign, `margin-top:${Math.max(3, pg.mt * 0.35)}mm`),
      footerTemplate: tpl(doc && doc.footer, doc && doc.footerAlign, `margin-bottom:${Math.max(3, pg.mb * 0.35)}mm`),
    });
    if (action === 'preview') {
      const tmp = path.join(require('os').tmpdir(), `OfficeStudio-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, pdf);
      const pv = new BrowserWindow({ width: 1000, height: 900, title: `Предпросмотр — ${suggestedName || 'Документ'} (печать: Ctrl+P или значок принтера)`, parent: win, webPreferences: { plugins: true } });
      pv.setMenuBarVisibility(false);
      pv.on('closed', () => { try { fs.rmSync(tmp, { force: true }); } catch {} });
      await pv.loadURL('file://' + tmp.replace(/\\/g, '/'));
      return { ok: true };
    }
    fs.writeFileSync(target, pdf);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    pw.destroy();
  }
});

// Any ready-made HTML (slides, spreadsheet pages) -> PDF of a given paper size, or a print preview window
ipcMain.handle('print-html', async (e, { html, css, widthMm, heightMm, marginMm = 0, action = 'pdf', suggestedName }) => {
  let target = null;
  if (action === 'pdf' && process.env.OS_TEST_PDF) target = process.env.OS_TEST_PDF;
  else if (action === 'pdf') {
    const r = await dialog.showSaveDialog(win, { title: 'Экспорт в PDF', defaultPath: path.join(app.getPath('documents'), (suggestedName || 'Файл').replace(/\.[^.]+$/, '') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    target = r.filePath;
  }
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'oshtml-'));
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  try {
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      @page { size: ${widthMm}mm ${heightMm}mm; margin: ${marginMm}mm; }
      html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      ${css || ''}
    </style></head><body>${html}</body></html>`;
    const f = path.join(tmpDir, 'page.html');
    fs.writeFileSync(f, page);
    await pw.loadFile(f);
    const pdf = await pw.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
    if (action === 'preview') {
      const tmp = path.join(require('os').tmpdir(), `OfficeStudio-${Date.now()}.pdf`);
      fs.writeFileSync(tmp, pdf);
      const pv = new BrowserWindow({ width: 1000, height: 900, title: `Предпросмотр — ${suggestedName || ''} (печать: Ctrl+P или значок принтера)`, parent: win, webPreferences: { plugins: true } });
      pv.setMenuBarVisibility(false);
      pv.on('closed', () => { try { fs.rmSync(tmp, { force: true }); } catch {} });
      await pv.loadURL('file://' + tmp.replace(/\\/g, '/'));
      return { ok: true };
    }
    fs.writeFileSync(target, pdf);
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    pw.destroy();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

ipcMain.handle('export-png', async (e, { dataUrl, suggestedName }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Экспорт изображения', defaultPath: path.join(app.getPath('pictures'), (suggestedName || 'Чертёж').replace(/\.[^.]+$/, '') + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { ok: true, path: r.filePath };
});

// A rendered sheet (PNG at print resolution) -> PDF of the exact paper size, or the system print dialog
ipcMain.handle('print-raster', async (e, { png, widthMm, heightMm, action, suggestedName }) => {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'osprint-'));
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: action !== 'print', javascript: false } });
  try {
    fs.writeFileSync(path.join(tmp, 'sheet.png'), Buffer.from(png));
    fs.writeFileSync(path.join(tmp, 'sheet.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><style>@page{size:${widthMm}mm ${heightMm}mm;margin:0}html,body{margin:0;padding:0}img{display:block;width:${widthMm}mm;height:${heightMm}mm}</style></head><body><img src="sheet.png"></body></html>`);
    await pw.loadFile(path.join(tmp, 'sheet.html'));
    if (action === 'print') {
      const ok = await new Promise((resolve) => pw.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' }, pageSize: { width: Math.round(widthMm * 1000), height: Math.round(heightMm * 1000) } }, (success, why) => resolve(success || why)));
      return ok === true ? { ok: true } : { ok: false, canceled: ok === 'cancelled', error: String(ok) };
    }
    const r = process.env.OS_TEST_PDF ? { filePath: process.env.OS_TEST_PDF } : await dialog.showSaveDialog(win, { title: 'Сохранить PDF', defaultPath: path.join(app.getPath('documents'), (suggestedName || 'Чертёж').replace(/\.[^.]+$/, '') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const pdf = await pw.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, margins: { marginType: 'none' } });
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  } finally {
    pw.destroy();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
});

ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Вставить изображение', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }[ext] || `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
});

ipcMain.handle('get-recent', () => getRecent().map((p) => ({ path: p, name: path.basename(p), dir: path.dirname(p), kind: kindOf(path.extname(p).toLowerCase()) || 'doc' })));
ipcMain.handle('clear-recent', () => { try { fs.writeFileSync(recentFile(), '[]'); } catch {} return true; });
ipcMain.handle('show-in-folder', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('confirm', async (e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  return r.response;
});
// ------------------------------------------------------------------ terms of use
const TERMS_VERSION = 1;
const termsFile = () => path.join(app.getPath('userData'), 'terms.json');
ipcMain.handle('terms-get', () => {
  let accepted = false;
  try { accepted = JSON.parse(fs.readFileSync(termsFile(), 'utf8')).version >= TERMS_VERSION; } catch {}
  return { text: fs.readFileSync(path.join(__dirname, 'disclaimer.txt'), 'utf8'), accepted };
});
ipcMain.handle('terms-accept', () => { try { fs.mkdirSync(app.getPath('userData'), { recursive: true }); fs.writeFileSync(termsFile(), JSON.stringify({ version: TERMS_VERSION, at: new Date().toISOString() })); } catch {} return true; });
ipcMain.handle('terms-decline', () => { forceQuit = true; app.quit(); });

ipcMain.handle('force-close', () => { forceQuit = true; win && win.close(); });
ipcMain.handle('set-title', (e, t) => { if (win) win.setTitle(t); });
ipcMain.handle('take-pending', () => pendingOpen.splice(0));
ipcMain.handle('read-wasm', () => new Uint8Array(fs.readFileSync(path.join(__dirname, 'renderer', 'cadcore', 'cadcore_bg.wasm'))));

// ------------------------------------------------------------------ menu
// In an embedded editor its own keys work (Ctrl+S, Ctrl+Z, Ctrl+F…): those menu items keep their
// labels but do not take the key away from it.
let menuMode = 'classic';
function menu() {
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  const OWN_KEYS = new Set(['save', 'save-as', 'export', 'print', 'undo', 'redo', 'find']);
  const own = (it) => (it.click && it.cmd && menuMode === 'craft' && OWN_KEYS.has(it.cmd) ? { ...it, registerAccelerator: false } : it);
  const tpl = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый документ', accelerator: 'CmdOrCtrl+N', click: send('new-doc'), cmd: 'new-doc' },
        { label: 'Новая презентация', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-slides'), cmd: 'new-slides' },
        { label: 'Новая таблица', accelerator: 'CmdOrCtrl+Alt+T', click: send('new-sheet'), cmd: 'new-sheet' },
        { label: 'Новый чертёж', accelerator: 'CmdOrCtrl+Alt+N', click: send('new-cad'), cmd: 'new-cad' },
        { type: 'separator' },
        { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', click: send('open'), cmd: 'open' },
        { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: send('save'), cmd: 'save' },
        { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as'), cmd: 'save-as' },
        { label: 'Экспорт…', accelerator: 'CmdOrCtrl+E', click: send('export'), cmd: 'export' },
        { label: 'Печать…', accelerator: 'CmdOrCtrl+P', click: send('print'), cmd: 'print' },
        { type: 'separator' },
        { label: 'Закрыть вкладку', accelerator: 'CmdOrCtrl+W', click: send('close-tab'), cmd: 'close-tab' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: send('undo'), cmd: 'undo' },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Y', click: send('redo'), cmd: 'redo' },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
        { type: 'separator' },
        { label: 'Найти и заменить', accelerator: 'CmdOrCtrl+F', click: send('find'), cmd: 'find' },
        { type: 'separator' },
        { label: 'Пометки карандашом поверх', accelerator: 'CmdOrCtrl+/', click: send('annotate'), cmd: 'annotate' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Следующая вкладка', accelerator: 'Ctrl+Tab', click: send('next-tab'), cmd: 'next-tab' },
        { label: 'Предыдущая вкладка', accelerator: 'Ctrl+Shift+Tab', click: send('prev-tab'), cmd: 'prev-tab' },
        { type: 'separator' },
        { label: 'Во весь экран', role: 'togglefullscreen' },
        { label: 'Инструменты разработчика', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Проверить обновления…', click: send('check-updates'), cmd: 'check-updates' },
        { label: 'Горячие клавиши', click: send('shortcuts'), cmd: 'shortcuts' },
        { label: 'Условия использования', click: send('terms'), cmd: 'terms' },
        { label: 'О программе', click: () => dialog.showMessageBox(win, { type: 'info', title: 'О программе', message: 'OfficeStudio ' + app.getVersion(), detail: 'Документы (DOCX), таблицы (XLSX, CSV), презентации (PPTX) и чертежи (DWG/DXF).\n\nПрограмма предоставляется «как есть», без каких-либо гарантий. Вы используете её на свой страх и риск; автор не несёт ответственности за любой ущерб, в том числе за потерю данных. Подробно — Справка → Условия использования.\n\nЛицензия GNU GPL v3. Чтение DWG: LibreDWG (GPL-3.0). Формулы: HyperFormula (GPL-3.0).\n\nВстроенные редакторы WordCraft, GridCraft, DeckCraft и CADCraft — открытые программы команды ArtCraft (github.com/storytold, лицензия MIT или Apache-2.0); DeckCraft собран с доработкой OfficeStudio для обмена файлами. OfficeStudio не связана с ArtCraft.' }) },
      ],
    },
  ];
  for (const m of tpl) m.submenu = m.submenu.map((it) => { const o = own(it); delete o.cmd; return o; });
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ------------------------------------------------------------------ window
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && kindOf(path.extname(a).toLowerCase()) && fs.existsSync(a));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 600,
    title: 'OfficeStudio',
    backgroundColor: '#f4f5f7',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: true },
  });
  win.webContents.session.setSpellCheckerLanguages(['ru', 'en-US']);
  win.loadURL('os://app/index.html');
  win.on('close', (e) => {
    if (forceQuit) return;
    e.preventDefault();
    win.webContents.send('menu', 'app-close-request');
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // the embedded editors may ask for fonts installed in Windows (Local Font Access) and the clipboard
  win.webContents.session.setPermissionRequestHandler((wc, perm, cb, details) => cb(/^os:\/\/app\//.test(details.requestingUrl || '') && ['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm)));
  win.webContents.session.setPermissionCheckHandler((wc, perm, origin) => /^os:\/\/app/.test(origin || '') && ['local-fonts', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(perm));
}

// Drawings render through WebGL2. Allow it on blocklisted GPUs/drivers and fall back to the
// software rasteriser (SwiftShader) when there is no usable GPU (e.g. remote desktop sessions).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
// the embedded editors follow the browser's language
app.commandLine.appendSwitch('lang', 'ru');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const files = filesFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      files.forEach((f) => win.webContents.send('open-path', f));
    }
  });
  app.whenReady().then(() => {
    protocol.handle('os', serveApp);
    pendingOpen.push(...filesFromArgv(process.argv));
    menu();
    createWindow();
    setupUpdater(() => win, () => { forceQuit = true; });
  });
  app.on('window-all-closed', () => app.quit());
}
