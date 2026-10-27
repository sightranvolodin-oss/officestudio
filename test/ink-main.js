// Red-pencil end-to-end test: draws with real mouse events in all editors, saves, reopens.
// Usage: INK_ARGS="<samplesDir>|<outDir>" xvfb-run -a electron --no-sandbox test/ink-main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const [samples, out] = process.env.INK_ARGS.split('|');
fs.mkdirSync(out, { recursive: true });
require('../src/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];

app.whenReady().then(async () => {
  await wait(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setSize(1440, 900);
  const wc = win.webContents;
  wc.on('console-message', (e) => { if (e.level === 'error') errors.push(e.message); });
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  if (process.env.FORCE_GL) await js('window.OS_FORCE_GL = true;');
  const shot = async (name) => { await wait(400); fs.writeFileSync(path.join(out, name + '.png'), (await wc.capturePage()).toPNG()); };
  // drag through a list of client points using real input events
  const drag = async (pts) => {
    wc.sendInputEvent({ type: 'mouseMove', x: pts[0][0], y: pts[0][1] });
    wc.sendInputEvent({ type: 'mouseDown', x: pts[0][0], y: pts[0][1], button: 'left', clickCount: 1 });
    for (const [x, y] of pts.slice(1)) { wc.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', modifiers: ['leftButtonDown'] }); await wait(8); }
    const l = pts[pts.length - 1];
    wc.sendInputEvent({ type: 'mouseUp', x: l[0], y: l[1], button: 'left', clickCount: 1 });
    await wait(150);
  };
  const circle = (cx, cy, r, n = 28) => Array.from({ length: n + 1 }, (_, i) => [Math.round(cx + r * Math.cos((i / n) * 6.3)), Math.round(cy + r * Math.sin((i / n) * 6.3))]);
  const zig = (x, y) => [[x, y], [x + 30, y + 25], [x + 60, y], [x + 90, y + 25], [x + 120, y]];
  const step = async (name, fn) => { try { await fn(); console.log('OK   ', name); } catch (e) { console.log('FAIL ', name, e.message); errors.push(name + ': ' + e.message); } };

  // ---------------- DOCX
  await step('docx pencil', async () => {
    await js(`await App.openPaths([${JSON.stringify(path.join(samples, 'word_made.docx'))}]); await new Promise(r=>setTimeout(r,500)); App.active().editor.setInkMode('pencil');`);
    const r = await js(`const ed = App.active().editor; const b = ed.page.querySelector('p').getBoundingClientRect(); return [b.left, b.top, b.right];`);
    await drag(circle(r[0] + 140, r[1] + 10, 40));
    await drag(zig(r[0] + 260, r[1] + 120));
    const n = await js(`return App.active().editor.inks.length;`);
    if (n !== 2) throw new Error('strokes ' + n);
    await shot('ink-01-docx');
    const res = await js(`return await window.api.saveFile({ kind: 'doc', data: App.active().editor.getData(), path: ${JSON.stringify(path.join(out, 'ink.docx'))} });`);
    if (!res.ok) throw new Error(res.error);
  });
  await step('docx eraser + undo', async () => {
    const r = await js(`const ed = App.active().editor; ed.setInkMode('eraser'); const p = ed.inks[1].pts[2]; const pr = ed.page.getBoundingClientRect(); return [pr.left + p[0] * pr.width / 794, pr.top + p[1] * pr.width / 794];`);
    await drag([[r[0] - 5, r[1]], [r[0] + 5, r[1]]]);
    const n = await js(`return App.active().editor.inks.length;`);
    if (n !== 1) throw new Error('after erase ' + n);
    const u = await js(`const ed = App.active().editor; ed.undo(); return ed.inks.length;`);
    if (u !== 2) throw new Error('after undo ' + u);
  });
  await step('docx reopen keeps strokes', async () => {
    const before = await js(`return App.active().editor.inks.map(s => s.pts[0]);`);
    await js(`await App.openPaths([${JSON.stringify(path.join(out, 'ink.docx'))}]); await new Promise(r=>setTimeout(r,600));`);
    const after = await js(`return App.active().editor.inks.map(s => s.pts[0]);`);
    if (after.length !== 2) throw new Error('reopened strokes ' + after.length);
    const d = Math.max(...after.map((p, i) => Math.hypot(p[0] - before[i][0], p[1] - before[i][1])));
    console.log('      position drift after reopen: ' + d.toFixed(1) + ' px');
    if (d > 25) throw new Error('drift ' + d);
    await shot('ink-02-docx-reopened');
  });

  // ---------------- PPTX
  await step('pptx pencil', async () => {
    await js(`await App.openPaths([${JSON.stringify(path.join(samples, 'py_made.pptx'))}]); await new Promise(r=>setTimeout(r,500)); const ed = App.active().editor; ed.go(1); ed.setTool('pencil');`);
    const r = await js(`const b = App.active().editor.stage.getBoundingClientRect(); return [b.left, b.top, b.width, b.height];`);
    await drag(circle(r[0] + r[2] * 0.75, r[1] + r[3] * 0.25, 70));
    await drag(zig(r[0] + r[2] * 0.2, r[1] + r[3] * 0.6));
    const n = await js(`return App.active().editor.slide().elements.filter(e => e.type === 'ink').length;`);
    if (n !== 2) throw new Error('ink elements ' + n);
    await shot('ink-03-pptx');
    const res = await js(`return await window.api.saveFile({ kind: 'slides', data: App.active().editor.getData(), path: ${JSON.stringify(path.join(out, 'ink.pptx'))} });`);
    if (!res.ok) throw new Error(res.error);
    await js(`await App.openPaths([${JSON.stringify(path.join(out, 'ink.pptx'))}]); await new Promise(r=>setTimeout(r,500)); App.active().editor.go(1);`);
    const m = await js(`return App.active().editor.slide().elements.filter(e => e.type === 'ink').length;`);
    if (m !== 2) throw new Error('reopened ink ' + m);
    await shot('ink-04-pptx-reopened');
  });
  await step('pptx eraser', async () => {
    await js(`App.active().editor.setTool('eraser');`);
    const r = await js(`const ed = App.active().editor; const e = ed.slide().elements.filter(x => x.type === 'ink')[0]; const p = e.paths[0][3]; const b = ed.stage.getBoundingClientRect(); const k = ed.scale * 96; return [b.left + (e.x + p[0] * e.w / e.vw) * k, b.top + (e.y + p[1] * e.h / e.vh) * k];`);
    await drag([[r[0] - 4, r[1]], [r[0] + 4, r[1]]]);
    const n = await js(`return App.active().editor.slide().elements.filter(e => e.type === 'ink').length;`);
    if (n !== 1) throw new Error('after erase ' + n);
  });

  // ---------------- DWG
  await step('dwg pencil', async () => {
    await js(`await App.openPaths([${JSON.stringify(path.join(samples, 'example_2018.dwg'))}]); const ed = App.active().editor; await ed.ready; ed.view = { cx: 4100, cy: 1000, s: 0.075 }; ed.redraw(); ed.startCmd('pencil');`);
    const r = await js(`const b = App.active().editor.over.getBoundingClientRect(); return [b.left, b.top, b.width, b.height];`);
    await drag(circle(r[0] + r[2] * 0.5, r[1] + r[3] * 0.45, 90));
    await drag(zig(r[0] + 200, r[1] + 500));
    const n = await js(`const ed = App.active().editor; return [ed.eng.layer_count_of('Пометки'), ed.layers.some(l => l.name === 'Пометки')];`);
    if (n[0] !== 2 || !n[1]) throw new Error('ink ' + n);
    await shot('ink-05-dwg');
    const res = await js(`return await window.api.saveFile({ kind: 'cad', data: App.active().editor.getData(), path: ${JSON.stringify(path.join(out, 'ink.dxf'))} });`);
    if (!res.ok) throw new Error(res.error);
  });
  await step('dwg eraser keeps drawing', async () => {
    const total = await js(`return App.active().editor.eng.count();`);
    await js(`App.active().editor.startCmd('inkerase');`);
    const r = await js(`const b = App.active().editor.over.getBoundingClientRect(); return [b.left, b.top, b.width, b.height];`);
    // sweep across the whole canvas: only pencil marks may disappear
    for (let y = 40; y < r[3]; y += 12) await drag(Array.from({ length: 60 }, (_, i) => [Math.round(r[0] + 5 + (i / 59) * (r[2] - 10)), r[1] + y]));
    const left = await js(`const ed = App.active().editor; return [ed.eng.count(), ed.eng.layer_count_of('Пометки')];`);
    if (left[1] !== 0 || left[0] !== total - 2) throw new Error('after sweep ' + left + ' of ' + total);
    await js(`App.active().editor.undo();`);
  });

  console.log('\nRenderer errors:', errors.length ? errors : 'none');
  app.exit(errors.length ? 1 : 0);
});
