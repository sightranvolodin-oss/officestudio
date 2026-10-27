// Embedded editors: open a file of every kind, save it back, open a new one.
// Usage: xvfb-run -a electron --no-sandbox test/craft-main.js <outDir> <docx> <xlsx> <pptx> <dwg>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(-5);
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
    fs.writeFileSync(path.join(out, `open${i}.png`), (await wc.capturePage()).toPNG());
    const r = await js(`return await App.save(App.active(), false)`);
    const tab = JSON.parse(await js(`const t = App.active(); return JSON.stringify({ name: t.name, path: t.path, dirty: t.dirty })`));
    check('save ' + path.basename(f), r === true && tab.path && fs.existsSync(tab.path) && fs.statSync(tab.path).size > 100, JSON.stringify(tab));
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
