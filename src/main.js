const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { docxToHtml, htmlToDocx } = require('./converters/docx');
const { pptxToModel } = require('./converters/pptx-read');
const { modelToPptx } = require('./converters/pptx-write');
const { cadFileToDxf } = require('./converters/cad');
const { setupUpdater } = require('./updater');
const { xlsxToModel, modelToXlsx, parseCsv, modelToCsv } = require('./converters/xlsx');

let win = null;
let forceQuit = false;
const pendingOpen = [];

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
const FILTERS = {
  doc: [{ name: 'Документ Word', extensions: ['docx'] }, { name: 'Веб-страница', extensions: ['html'] }],
  slides: [{ name: 'Презентация PowerPoint', extensions: ['pptx'] }],
  cad: [{ name: 'Чертёж DXF (открывается в AutoCAD)', extensions: ['dxf'] }],
  sheet: [{ name: 'Книга Excel', extensions: ['xlsx'] }, { name: 'CSV (разделитель «;», UTF-8)', extensions: ['csv'] }],
};
const OPEN_FILTERS = [
  { name: 'Все поддерживаемые', extensions: ['docx', 'xlsx', 'xlsm', 'csv', 'pptx', 'dwg', 'dxf', 'txt', 'html', 'htm', 'md'] },
  { name: 'Документы Word', extensions: ['docx'] },
  { name: 'Таблицы Excel', extensions: ['xlsx', 'xlsm', 'csv'] },
  { name: 'Презентации PowerPoint', extensions: ['pptx'] },
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
    return htmlToDocx(data.html, { title: path.basename(targetPath, ext) }, data.inks || []);
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

ipcMain.handle('export-pdf', async (e, { html, suggestedName }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Экспорт в PDF', defaultPath: path.join(app.getPath('documents'), (suggestedName || 'Документ').replace(/\.[^.]+$/, '') + '.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  const pw = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  try {
    const page = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:11pt;line-height:1.35;color:#000}
      table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px 6px;vertical-align:top}
      img{max-width:100%}.page-break{page-break-after:always;height:0;border:0}
      h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}blockquote{border-left:3px solid #aaa;margin-left:0;padding-left:12px;color:#444}
    </style></head><body>${html}</body></html>`;
    await pw.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page));
    const pdf = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { top: 0.8, bottom: 0.8, left: 0.8, right: 0.8 } });
    fs.writeFileSync(r.filePath, pdf);
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    pw.destroy();
  }
});

ipcMain.handle('export-png', async (e, { dataUrl, suggestedName }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Экспорт изображения', defaultPath: path.join(app.getPath('pictures'), (suggestedName || 'Чертёж').replace(/\.[^.]+$/, '') + '.png'), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(r.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return { ok: true, path: r.filePath };
});

ipcMain.handle('pick-image', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Вставить изображение', properties: ['openFile'], filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = { jpg: 'image/jpeg', jpeg: 'image/jpeg', svg: 'image/svg+xml' }[ext] || `image/${ext}`;
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
});

ipcMain.handle('get-recent', () => getRecent().map((p) => ({ path: p, name: path.basename(p), dir: path.dirname(p), kind: KIND_BY_EXT[path.extname(p).toLowerCase()] || 'doc' })));
ipcMain.handle('clear-recent', () => { try { fs.writeFileSync(recentFile(), '[]'); } catch {} return true; });
ipcMain.handle('show-in-folder', (e, p) => shell.showItemInFolder(p));
ipcMain.handle('confirm', async (e, { message, detail, buttons }) => {
  const r = await dialog.showMessageBox(win, { type: 'question', message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1, noLink: true });
  return r.response;
});
ipcMain.handle('force-close', () => { forceQuit = true; win && win.close(); });
ipcMain.handle('set-title', (e, t) => { if (win) win.setTitle(t); });
ipcMain.handle('take-pending', () => pendingOpen.splice(0));
ipcMain.handle('read-wasm', () => new Uint8Array(fs.readFileSync(path.join(__dirname, 'renderer', 'cadcore', 'cadcore_bg.wasm'))));

// ------------------------------------------------------------------ menu
function menu() {
  const send = (cmd) => () => win && win.webContents.send('menu', cmd);
  const tpl = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Новый документ', accelerator: 'CmdOrCtrl+N', click: send('new-doc') },
        { label: 'Новая презентация', accelerator: 'CmdOrCtrl+Shift+N', click: send('new-slides') },
        { label: 'Новая таблица', accelerator: 'CmdOrCtrl+Alt+T', click: send('new-sheet') },
        { label: 'Новый чертёж', accelerator: 'CmdOrCtrl+Alt+N', click: send('new-cad') },
        { type: 'separator' },
        { label: 'Открыть…', accelerator: 'CmdOrCtrl+O', click: send('open') },
        { label: 'Сохранить', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Сохранить как…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
        { label: 'Экспорт…', accelerator: 'CmdOrCtrl+E', click: send('export') },
        { type: 'separator' },
        { label: 'Закрыть вкладку', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { label: 'Отменить', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Повторить', accelerator: 'CmdOrCtrl+Y', click: send('redo') },
        { type: 'separator' },
        { label: 'Вырезать', role: 'cut' },
        { label: 'Копировать', role: 'copy' },
        { label: 'Вставить', role: 'paste' },
        { label: 'Выделить всё', role: 'selectAll' },
        { type: 'separator' },
        { label: 'Найти и заменить', accelerator: 'CmdOrCtrl+F', click: send('find') },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Следующая вкладка', accelerator: 'Ctrl+Tab', click: send('next-tab') },
        { label: 'Предыдущая вкладка', accelerator: 'Ctrl+Shift+Tab', click: send('prev-tab') },
        { type: 'separator' },
        { label: 'Во весь экран', role: 'togglefullscreen' },
        { label: 'Инструменты разработчика', accelerator: 'F12', role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Проверить обновления…', click: send('check-updates') },
        { label: 'Горячие клавиши', click: send('shortcuts') },
        { label: 'О программе', click: () => dialog.showMessageBox(win, { type: 'info', title: 'О программе', message: 'OfficeStudio ' + app.getVersion(), detail: 'Документы (DOCX), таблицы (XLSX, CSV), презентации (PPTX) и чертежи (DWG/DXF).\n\nЧтение DWG: LibreDWG (GPL-3.0). Формулы: HyperFormula (GPL-3.0).' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

// ------------------------------------------------------------------ window
function filesFromArgv(argv) {
  return argv.slice(1).filter((a) => !a.startsWith('-') && KIND_BY_EXT[path.extname(a).toLowerCase()] && fs.existsSync(a));
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
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (forceQuit) return;
    e.preventDefault();
    win.webContents.send('menu', 'app-close-request');
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Drawings render through WebGL2. Allow it on blocklisted GPUs/drivers and fall back to the
// software rasteriser (SwiftShader) when there is no usable GPU (e.g. remote desktop sessions).
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

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
    pendingOpen.push(...filesFromArgv(process.argv));
    menu();
    createWindow();
    setupUpdater(() => win, () => { forceQuit = true; });
  });
  app.on('window-all-closed', () => app.quit());
}
