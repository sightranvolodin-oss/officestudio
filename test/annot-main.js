// Pencil marks over a tab (Ctrl+/): full editor tab gets an overlay; classic editors toggle their pencil.
// Usage: ANNOT_ARGS="<outDir>|<docx>" xvfb-run -a electron --no-sandbox test/annot-main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const [out, docx] = process.env.ANNOT_ARGS.split('|');
fs.mkdirSync(out, { recursive: true });
process.env.OS_TEST_SAVE_DIR = out;
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = [];
let failed = 0;
const check = (n, ok, info = '') => { log.push((ok ? 'OK   ' : 'FAIL ') + n + ' ' + info); if (!ok) failed++; fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n')); };
app.whenReady().then(async () => {
  await wait(2000);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1400, 900);
  const wc = win.webContents;
  const js = (c) => wc.executeJavaScript(`(async () => { ${c} })()`);
  await js(`document.querySelector('.modal-back') && document.querySelector('.modal-back').remove()`);
  await js(`await App.openPaths([${JSON.stringify(docx)}])`);
  for (let k = 0; k < 60; k++) { await wait(500); if (await js(`const t = App.active(); return !!(t && t.craft && t.editor.ready)`)) break; }
  await wait(3000);
  wc.send('menu', 'annotate');
  await wait(500);
  check('overlay on', await js(`return document.querySelector('.annot-layer').classList.contains('on')`));
  const drag = async (pts) => { wc.sendInputEvent({ type: 'mouseDown', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 }); for (const [x, y] of pts.slice(1)) { wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonIsDown'] }); await wait(16); } const l = pts[pts.length - 1]; wc.sendInputEvent({ type: 'mouseUp', x: l[0], y: l[1], button: 'left', clickCount: 1 }); await wait(100); };
  await drag([[400, 400], [450, 420], [500, 450], [560, 480], [620, 470]]);
  await drag([[400, 600], [700, 600]]);
  check('two strokes', (await js(`return App.active().annot.length`)) === 2);
  await js(`document.querySelector('.annot-bar .annot-btn[title^="Отменить"]').click()`);
  check('undo', (await js(`return App.active().annot.length`)) === 1);
  fs.writeFileSync(path.join(out, 'overlay.png'), (await wc.capturePage()).toPNG());
  await js(`document.querySelector('.annot-bar .annot-btn[title^="Сохранить снимок"]').click()`);
  await wait(1500);
  check('snapshot saved', fs.existsSync(path.join(out, 'annot.png')) && fs.statSync(path.join(out, 'annot.png')).size > 1000);
  wc.send('menu', 'annotate');
  await wait(300);
  check('overlay off, marks stay', !(await js(`return document.querySelector('.annot-layer').classList.contains('on')`)) && (await js(`return document.querySelector('.annot-layer').classList.contains('has')`)));
  // the marks come back when the file is opened again
  await js(`const t = App.active(); t.dirty = false; App.tabs(); document.querySelector('.tab.active .x').click()`);
  await wait(1500);
  await js(`await App.openPaths([${JSON.stringify(docx)}])`);
  for (let k = 0; k < 60; k++) { await wait(500); if (await js(`const t = App.active(); return !!(t && t.craft && t.editor.ready)`)) break; }
  await wait(800);
  check('marks restored after reopening', (await js(`return (App.active().annot || []).length`)) === 1 && (await js(`return document.querySelector('.annot-layer').classList.contains('has')`)));
  // Ctrl+/ pressed while the keyboard focus is inside the editor
  await js(`const w = App.active().editor.win; w.dispatchEvent(new w.KeyboardEvent('keydown', { key: '.', code: 'Slash', ctrlKey: true, bubbles: true, cancelable: true }))`);
  await wait(300);
  check('Ctrl+/ inside the editor (any layout)', await js(`return document.querySelector('.annot-layer').classList.contains('on')`));
  check('tab bar button shows the state', await js(`return document.getElementById('annot-btn').classList.contains('on')`));
  await js(`document.getElementById('annot-btn').click()`);
  await wait(400);
  check('tab bar button turns it off', !(await js(`return document.querySelector('.annot-layer').classList.contains('on')`)));
  // switching tabs hides the marks of the other tab
  await js(`App.newFile('sheet')`);
  await wait(1500);
  check('other tab has no marks', !(await js(`return document.querySelector('.annot-layer').classList.contains('has')`)));
  // classic editor: the shortcut turns on its own pencil
  await js(`App.newFile('doc', { classic: true })`);
  await wait(1000);
  wc.send('menu', 'annotate');
  await wait(300);
  check('classic pencil on', (await js(`return App.active().editor.inkMode`)) === 'pencil');
  log.push(failed ? `FAILED: ${failed}` : 'NO ERRORS');
  fs.writeFileSync(path.join(out, 'log.txt'), log.join('\n'));
  app.exit(failed ? 1 : 0);
});
