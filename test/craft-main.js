// Embedded editors: open a file of every kind, save it back, open a new one.
// Usage: CRAFT_ARGS="<outDir>|<docx>|<xlsx>|<pptx>|<dwg>" xvfb-run -a electron --no-sandbox test/craft-main.js
// (not on the command line: the app would open those files by itself at start)
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const args = process.env.CRAFT_ARGS.split('|');
const out = args[0];
fs.mkdirSync(out, { recursive: true });
process.env.OS_TEST_SAVE_DIR = out;
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
const L = (...a) => { log.push(a.join(' ')); fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n')); };
let failed = 0;
const check = (name, ok, info = '') => { L(ok ? 'OK  ' : 'FAIL', name, info); if (!ok) failed++; };
app.whenReady().then(async () => {
  await wait(2000);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  const wc = win.webContents;
  wc.on('console-message', (e) => { if (e.level === 'error') L('CONSOLE', String(e.message).slice(0, 300)); });
  const js = (c) => wc.executeJavaScript(`(async () => { ${c} })()`);
  await js(`document.querySelector('.modal-back') && document.querySelector('.modal-back').remove()`);
  check('crafts installed', JSON.stringify(await js(`return App.settings().crafts`)) === '{"doc":true,"sheet":true,"slides":true,"cad":true}', JSON.stringify(await js(`return App.settings()`)));
  for (const [i, f] of args.slice(1).entries()) {
    const t0 = Date.now();
    await js(`await App.openPaths([${JSON.stringify(f)}])`);
    let ready = false;
    for (let k = 0; k < 120 && !ready; k++) { await wait(500); ready = await js(`const t = App.active(); return !!(t && t.craft && t.editor.ready)`); }
    check('ready ' + path.basename(f), ready, (Date.now() - t0) + ' ms');
    await wait(f.endsWith('.dwg') ? 15000 : 5000);
    if (f.endsWith('.docx')) {
      // type into the document with real key events
      await js(`App.active().editor.focus()`);
      win.focus(); wc.focus();
      wc.sendInputEvent({ type: 'mouseDown', x: 700, y: 330, button: 'left', clickCount: 1 });
      wc.sendInputEvent({ type: 'mouseUp', x: 700, y: 330, button: 'left', clickCount: 1 });
      await wait(500);
      for (const ch of 'ПРОВЕРКА ') { wc.sendInputEvent({ type: 'char', keyCode: ch }); await wait(30); }
      await wait(1500);
      check('typing marks the tab unsaved', await js(`return App.active().dirty`));
    }
    fs.writeFileSync(path.join(out, `open${i}.png`), (await wc.capturePage()).toPNG());
    const r = await js(`return await App.save(App.active(), false)`);
    const tab = JSON.parse(await js(`const t = App.active(); return JSON.stringify({ name: t.name, path: t.path, dirty: t.dirty })`));
    check('save ' + path.basename(f), r === true && tab.path && fs.existsSync(tab.path) && fs.statSync(tab.path).size > 100 && !tab.dirty, JSON.stringify(tab));
    const ext = path.extname(tab.path || '').toLowerCase();
    check('saved format ' + path.basename(f), ext === (f.endsWith('.dwg') ? '.dxf' : path.extname(f)), ext);
    if (/\.(docx|xlsx|pptx)$/.test(ext)) {
      const JSZip = require('jszip');
      const z = await JSZip.loadAsync(fs.readFileSync(tab.path));
      const main = { '.docx': 'word/document.xml', '.xlsx': 'xl/workbook.xml', '.pptx': 'ppt/presentation.xml' }[ext];
      check('valid ' + ext, !!z.file(main));
      if (ext === '.docx') check('typed text saved', (await z.file(main).async('string')).includes('ПРОВЕРКА'));
    }
    if (ext === '.dxf') check('valid dxf', /^\s*0\s*\r?\nSECTION/.test(fs.readFileSync(tab.path, 'latin1').slice(0, 100)));
  }
  // new files of every kind
  for (const k of ['doc', 'sheet', 'slides', 'cad']) {
    await js(`await App.newFile('${k}')`);
    let ready = false;
    for (let n = 0; n < 80 && !ready; n++) { await wait(500); ready = await js(`const t = App.active(); return !!(t && t.craft && t.editor.ready)`); }
    check('new ' + k, ready);
    await wait(3000);
    fs.writeFileSync(path.join(out, `new-${k}.png`), (await wc.capturePage()).toPNG());
  }
  L(failed ? `FAILED: ${failed}` : 'NO ERRORS');
  app.exit(failed ? 1 : 0);
});
