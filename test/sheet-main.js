// Spreadsheet editor test: opens an xlsx, checks recalculated values, drives the grid with real key/mouse events, saves xlsx + csv.
// Usage: xvfb-run -a electron --no-sandbox test/sheet-main.js <xlsxFile> <outDir>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [xlsx, out] = process.argv.slice(-2);
fs.mkdirSync(out, { recursive: true });
require('../src/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  await wait(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1440, 900);
  const wc = win.webContents;
  wc.on('console-message', (e, level, message) => { const lvl = e.level ?? level; const msg = e.message ?? message; if (lvl === 'error' || lvl === 3) errors.push(msg); });
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const shot = async (name) => { await wait(400); const img = await wc.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); };
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { console.log('FAIL ', name, e.message); errors.push(name + ': ' + e.message); }
  };
  const key = async (keyCode, modifiers = []) => { wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (keyCode.length === 1) wc.sendInputEvent({ type: 'char', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await wait(15); };
  const type = async (s) => { for (const ch of s) await key(ch); };
  const click = async (x, y, opts = {}) => {
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: opts.count || 1, modifiers: opts.modifiers || [] });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: opts.count || 1, modifiers: opts.modifiers || [] });
    await wait(60);
  };
  const cellXY = (a) => js(`const ed = App.active().editor; const m = /^([A-Z]+)(\\d+)$/.exec(${JSON.stringify(a)}); const c = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; const rc = ed.cellRect(+m[2] - 1, c); const b = ed.scroll.getBoundingClientRect(); return [Math.round(b.left + rc.x + rc.w / 2), Math.round(b.top + rc.y + rc.h / 2)];`);
  const disp = (a) => js(`const ed = App.active().editor; const m = /^([A-Z]+)(\\d+)$/.exec(${JSON.stringify(a)}); const c = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; return ed.display(+m[2] - 1, c);`);
  const eq = (a, b, what) => { if (a !== b) throw new Error(`${what}: ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); };

  await step('home has 4 cards', async () => {
    const n = await js(`return document.querySelectorAll('.create-card').length`);
    eq(n, 4, 'cards');
    await shot('s01-home');
  });

  await step('open xlsx + recalculated values', async () => {
    await js(`await App.openPaths([${JSON.stringify(xlsx)}]);`);
    await wait(500);
    const k = await js(`return App.active().kind`);
    eq(k, 'sheet', 'kind');
    const vals = await js(`const ed = App.active().editor; return [ed.value(1,4), ed.value(7,4), ed.value(1,8), ed.value(2,8), ed.value(3,8), ed.value(4,8), ed.value(7,5)]`);
    console.log('      values', JSON.stringify(vals), 'E2 shown as', await disp('E2'), 'A2 as', await disp('A2'), 'F2 as', await disp('F2'));
    eq(vals[0], 37500, 'E2=C2*D2');
    eq(Math.round(vals[1] * 100) / 100, 37500 + 12 * 3400.5 + 2 * 27999 + 7 * 1890 + 5 * 2450, 'B8 SUM');
    eq(Math.round(vals[2] * 10) / 10, Math.round((12500 + 3400.5 + 27999 + 1890 + 2450) / 5 * 10) / 10, 'AVERAGE');
    eq(vals[3], 'да', 'IF');
    eq(vals[4], 3400.5, 'VLOOKUP');
    eq(vals[5], 82, 'cross-sheet ref');
    eq(Math.round(vals[6] * 1e9) / 1e9, 1, 'share sum');
    eq(await disp('A2'), '02.10.2026', 'date format');
    await shot('s02-opened');
  });

  await step('type values + formula with Russian names', async () => {
    const [x, y] = await cellXY('C10');
    await click(x, y);
    await type('5');
    await key('Return');
    await type('2,5');
    await key('Return');
    await type('=СУММ(C10;C11)*2');
    await key('Return');
    eq(await disp('C12'), '15', 'formula result');
    const f = await js(`return App.active().editor.hf.getCellFormula({sheet: App.active().editor.sid, row: 11, col: 2})`);
    eq(f, '=SUM(C10,C11)*2', 'stored formula');
    eq(await disp('C11'), '2,5', 'decimal comma');
  });

  await step('dates, percent, currency input', async () => {
    const [x, y] = await cellXY('D10');
    await click(x, y);
    await type('26.10.2026'); await key('Return');
    await type('15%'); await key('Return');
    await type('1500р'); await key('Return');
    eq(await disp('D10'), '26.10.2026', 'date');
    eq(await disp('D11'), '15%', 'percent');
    eq(await disp('D12'), '1 500,00 ₽', 'rub');
    eq(await js(`return App.active().editor.value(10, 3)`), 0.15, 'percent value');
  });

  await step('change dependency recalculates', async () => {
    const [x, y] = await cellXY('C2');
    await click(x, y);
    await type('4'); await key('Return');
    eq(await js(`return App.active().editor.value(1, 4)`), 50000, 'E2 after C2=4');
  });

  await step('undo / redo', async () => {
    await js(`App.active().editor.undo()`);
    eq(await js(`return App.active().editor.value(1, 4)`), 37500, 'undo');
    await js(`App.active().editor.redo()`);
    eq(await js(`return App.active().editor.value(1, 4)`), 50000, 'redo');
    await js(`App.active().editor.undo()`);
  });

  await step('styles via toolbar + fill handle series', async () => {
    const [x, y] = await cellXY('G10');
    await click(x, y);
    await type('1'); await key('Return'); await type('2'); await key('Return');
    const [x1, y1] = await cellXY('G10');
    const [x2, y2] = await cellXY('G11');
    await click(x1, y1); await click(x2, y2, { modifiers: ['shift'] });
    await js(`const ed = App.active().editor; ed.toggleStyle('b'); ed.setStyle({ bg: '#fff2cc' }); ed.setBorders('all');`);
    // drag fill handle down 4 rows
    const h = await js(`const ed = App.active().editor; const b = ed.scroll.getBoundingClientRect(); return [Math.round(b.left + ed.handleRect.x + 5), Math.round(b.top + ed.handleRect.y + 5)];`);
    const [, y6] = await cellXY('G15');
    wc.sendInputEvent({ type: 'mouseDown', x: h[0], y: h[1], button: 'left', clickCount: 1 });
    for (let i = 1; i <= 6; i++) { wc.sendInputEvent({ type: 'mouseMove', x: h[0], y: Math.round(h[1] + ((y6 - h[1]) * i) / 6), button: 'left' }); await wait(30); }
    wc.sendInputEvent({ type: 'mouseUp', x: h[0], y: y6, button: 'left', clickCount: 1 });
    await wait(100);
    eq(await disp('G15'), '6', 'series');
    eq(await js(`return !!(App.active().editor.meta.styles.get('14:6') || {}).b`), true, 'style copied by fill');
    await shot('s03-edited');
  });

  await step('copy formulas with fill (relative refs)', async () => {
    const [x, y] = await cellXY('H10');
    await click(x, y);
    await type('=G10*10'); await key('Return');
    await click(x, y);
    await js(`const ed = App.active().editor; ed.fill({ r1: 9, c1: 7, r2: 9, c2: 7 }, { r1: 9, c1: 7, r2: 12, c2: 7 });`);
    eq(await js(`return App.active().editor.hf.getCellFormula({sheet: App.active().editor.sid, row: 12, col: 7})`), '=G13*10', 'relative ref');
    eq(await disp('H13'), '40', 'fill formula value');
  });

  await step('insert row shifts formulas', async () => {
    await js(`const ed = App.active().editor; ed.moveTo(3, 0); ed.insertRows(3, 1);`);
    const f = await js(`return App.active().editor.hf.getCellFormula({sheet: App.active().editor.sid, row: 8, col: 4})`);
    eq(f, '=SUM(E2:E7)', 'SUM range after insert');
    await js(`App.active().editor.undo()`);
    eq(await js(`return App.active().editor.hf.getCellFormula({sheet: App.active().editor.sid, row: 7, col: 4})`), '=SUM(E2:E6)', 'undo insert');
  });

  await step('sheet tabs', async () => {
    await js(`const ed = App.active().editor; ed.addSheet();`);
    eq(await js(`return App.active().editor.metas.length`), 3, 'sheets');
    await type('Привет');
    await key('Return');
    eq(await disp('A1'), 'Привет', 'typed on new sheet');
    await shot('s04-new-sheet');
    await js(`App.active().editor.switchSheet(0)`);
  });

  await step('freeze + scroll + zoom render', async () => {
    await js(`const ed = App.active().editor; ed.moveTo(1, 1); ed.setFreeze(1, 1); ed.scroll.scrollTop = 600; ed.scroll.scrollLeft = 200;`);
    await shot('s05-frozen-scrolled');
    await js(`const ed = App.active().editor; ed.scroll.scrollTop = 0; ed.scroll.scrollLeft = 0; ed.setZoom(1.4);`);
    await shot('s06-zoom');
    await js(`App.active().editor.setZoom(1)`);
  });

  await step('editing ui (in-cell editor + ref picking)', async () => {
    const [x, y] = await cellXY('J3');
    await click(x, y);
    await type('=СРЗНАЧ(');
    const [a1, b1] = await cellXY('C2');
    const [a2, b2] = await cellXY('C6');
    wc.sendInputEvent({ type: 'mouseDown', x: a1, y: b1, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseMove', x: a2, y: b2, button: 'left' });
    await wait(50);
    wc.sendInputEvent({ type: 'mouseUp', x: a2, y: b2, button: 'left', clickCount: 1 });
    await wait(50);
    await shot('s07-ref-picking');
    await type(')'); await key('Return');
    eq(await disp('J3'), '5,8', 'AVERAGE via picked range');
  });

  await step('save xlsx + csv', async () => {
    const r = await js(`const ed = App.active().editor; const d = ed.getData();
      const a = await window.api.saveFile({ kind: 'sheet', data: d, path: ${JSON.stringify(path.join(out, 'saved.xlsx'))} });
      const b = await window.api.saveFile({ kind: 'sheet', data: d, path: ${JSON.stringify(path.join(out, 'saved.csv'))} });
      return [a, b];`);
    if (!r[0].ok) throw new Error(r[0].error);
    if (!r[1].ok) throw new Error(r[1].error);
  });

  await step('reopen saved xlsx', async () => {
    await js(`await App.openPaths([${JSON.stringify(path.join(out, 'saved.xlsx'))}]);`);
    await wait(400);
    eq(await disp('C12'), '15', 'C12 after reopen');
    eq(await disp('D12'), '1 500,00 ₽', 'D12 after reopen');
    eq(await disp('A2'), '02.10.2026', 'A2 after reopen');
    await shot('s08-reopened');
  });

  await step('new empty sheet', async () => {
    await js(`App.newFile('sheet')`);
    await wait(300);
    await type('Таблица'); await key('Tab'); await type('123'); await key('Return');
    eq(await disp('B1'), '123', 'B1');
    eq(await disp('A1'), 'Таблица', 'A1');
  });

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'NO ERRORS');
  app.exit(errors.length ? 1 : 0);
});
