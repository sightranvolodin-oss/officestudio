// End-to-end smoke test: boots the real app, drives each editor, saves files and takes screenshots.
// Usage: xvfb-run -a electron --no-sandbox test/smoke-main.js <samplesDir> <outDir>
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const [samples, out] = process.argv.slice(-2);
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
  wc.on('preload-error', (e, p, err) => errors.push('preload: ' + err));
  const js = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  if (process.env.FORCE_GL) await js('window.OS_FORCE_GL = true;');
  const shot = async (name) => { await wait(500); const img = await wc.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); };
  const step = async (name, fn) => {
    try { await fn(); console.log('OK   ', name); }
    catch (e) { console.log('FAIL ', name, e.message); errors.push(name + ': ' + e.message); }
  };

  await step('home', () => shot('01-home'));

  // ---------------- DOCX
  await step('docx open', async () => {
    await js(`await App.openPaths([${JSON.stringify(path.join(samples, 'word_made.docx'))}]);`);
    await shot('02-docx-open');
  });
  await step('docx edit + save', async () => {
    const r = await js(`
      const ed = App.active().editor;
      const p = ed.page.querySelector('p');
      const range = document.createRange(); range.selectNodeContents(p);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      ed.exec('bold'); ed.setFontSize(16); ed.exec('foreColor', '#1f9d6b', true);
      const end = document.createRange(); end.selectNodeContents(ed.page); end.collapse(false);
      getSelection().removeAllRanges(); getSelection().addRange(end);
      ed.insertTable(2, 3);
      ed.page.querySelector('table:last-of-type td').textContent = 'Новая ячейка';
      ed.exec('insertHTML', '<p>Добавлено автотестом: <b>жирный</b> <i>курсив</i></p>');
      ed.find(); ed.findInput.value = 'маркер'; ed.highlight();
      const hits = ed.hits.length;
      ed.replInput.value = 'пункт'; ed.replaceAll(); ed.closeFind();
      const res = await window.api.saveFile({ kind: 'doc', data: ed.getData(), path: ${JSON.stringify(path.join(out, 'saved.docx'))} });
      return { hits, res };`);
    if (!r.res.ok) throw new Error(r.res.error);
    if (r.hits !== 2) throw new Error('find hits = ' + r.hits);
    await shot('03-docx-edited');
  });

  // ---------------- PPTX
  await step('pptx open', async () => {
    await js(`await App.openPaths([${JSON.stringify(path.join(samples, 'py_made.pptx'))}]);`);
    await wait(500);
    await js(`App.active().editor.go(1);`);
    await shot('04-pptx-open');
  });
  await step('pptx edit + save', async () => {
    const r = await js(`
      const ed = App.active().editor;
      ed.insertBox('star5', 9.5, 4.5, 2, 2);
      ed.insertBox('text', 1, 6, 6, 0.8);
      const txt = ed.editTxt();
      txt.innerHTML = '<div class="p" data-bullet="false" style="text-align:left"><span style="font-size:28pt;color:#e2702f;font-weight:700">Надпись из автотеста</span></div>';
      ed.commitEdit();
      ed.addSlide('content');
      const s = ed.slide();
      s.elements[0].paras = [{ runs: [{ text: 'Новый слайд', size: 36, color: '#1d2330', font: 'Calibri', b: true }], align: 'left', bullet: false, level: 0 }];
      s.elements[1].paras = ['Пункт один', 'Пункт два'].map(t => ({ runs: [{ text: t, size: 24, color: '#1d2330', font: 'Calibri' }], align: 'left', bullet: true, level: 0 }));
      ed.renderStage(); ed.commit();
      ed.go(1);
      ed.sel = new Set([ed.slide().elements[ed.slide().elements.length - 2].id]); ed.drawSelection();
      const res = await window.api.saveFile({ kind: 'slides', data: ed.getData(), path: ${JSON.stringify(path.join(out, 'saved.pptx'))} });
      return { res, n: ed.model.slides.length };`);
    if (!r.res.ok) throw new Error(r.res.error);
    await shot('05-pptx-edited');
  });
  await step('pptx undo/redo', async () => {
    const r = await js(`const ed = App.active().editor; const before = ed.model.slides.length; ed.undo(); ed.undo(); const mid = ed.model.slides.length; ed.redo(); ed.redo(); return [before, mid, ed.model.slides.length];`);
    if (r[0] !== r[2]) throw new Error('undo/redo mismatch ' + r);
  });

  // ---------------- DWG
  await step('dwg open', async () => {
    const r = await js(`await App.openPaths([${JSON.stringify(path.join(samples, 'example_2018.dwg'))}]); const ed = App.active().editor; await ed.ready; return { n: ed.eng.count(), layers: ed.layers.length, hatch: ed.eng.sel_summary(Uint32Array.from({length: ed.eng.count()}, (_, i) => i)) };`);
    if (r.n < 52 || r.layers < 5) throw new Error('dwg contents ' + JSON.stringify(r));
    if (!r.hatch.includes('hatch')) throw new Error('hatch missing');
    await wait(500);
    await shot('06-dwg-open');
  });
  await step('dwg draw + save dxf', async () => {
    const r = await js(`
      const ed = App.active().editor;
      const n0 = ed.eng.count();
      ed.startCmd('line'); ed.handleInput('0,0'); ed.handleInput('@100,0'); ed.handleInput('@0,50'); ed.handleInput('');
      ed.startCmd('circle'); ed.handleInput('50,25'); ed.handleInput('20');
      ed.startCmd('rect'); ed.handleInput('120,0'); ed.handleInput('@40,30');
      ed.startCmd('dim'); ed.handleInput('0,0'); ed.handleInput('100,0'); ed.handleInput('50,-15');
      ed.sel = new Set([n0 + 2]); ed.startCmd('move'); ed.handleInput('50,25'); ed.handleInput('@10,10');
      ed.zoomExtents();
      const res = await window.api.saveFile({ kind: 'cad', data: ed.getData(), path: ${JSON.stringify(path.join(out, 'saved.dxf'))} });
      return { res, added: ed.eng.count() - n0, moved: JSON.parse(ed.eng.entity_json(n0 + 2)).c };`);
    if (!r.res.ok) throw new Error(r.res.error);
    if (r.added !== 5) throw new Error('added ' + r.added);
    if (Math.abs(r.moved.x - 60) > 1e-9) throw new Error('move failed ' + JSON.stringify(r.moved));
    await shot('07-dwg-edited');
  });

  // ---------------- new files
  await step('new slides', async () => { await js(`App.newFile('slides');`); await shot('08-new-slides'); });
  await step('new cad', async () => {
    await js(`App.newFile('cad'); const ed = App.active().editor; await ed.ready;
      ed.startCmd('rect'); ed.handleInput('0,0'); ed.handleInput('@297,210');
      ed.startCmd('arc'); ed.handleInput('40,40'); ed.handleInput('80,80'); ed.handleInput('120,40');
      ed.startCmd('pline'); ed.handleInput('150,40'); ed.handleInput('@40,0'); ed.handleInput('@0,40'); ed.handleInput('C');
      ed.add([{ layer: '0', type: 'text', p: { x: 20, y: 180 }, h: 8, text: 'Чертёж OfficeStudio', rot: 0, halign: 0, valign: 0 }]);
      ed.zoomExtents();`);
    await shot('09-new-cad');
  });
  await step('new doc', async () => { await js(`App.newFile('doc');`); await shot('10-new-doc'); });

  console.log('\nRenderer errors:', errors.length ? errors : 'none');
  fs.writeFileSync(path.join(out, 'errors.json'), JSON.stringify(errors, null, 2));
  app.exit(errors.length ? 1 : 0);
});
