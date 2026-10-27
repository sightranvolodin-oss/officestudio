// Slide model -> PPTX using pptxgenjs
const PptxGenJS = require('pptxgenjs');

const hex = (c) => (c ? String(c).replace('#', '').toUpperCase().slice(0, 6) : undefined);
const imgData = (d) => (d || '').replace(/^data:/, '');

const GEOM = {
  rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'rtTriangle', diamond: 'diamond',
  pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', rightArrow: 'rightArrow', leftArrow: 'leftArrow', upArrow: 'upArrow',
  downArrow: 'downArrow', star5: 'star5', line: 'line', parallelogram: 'parallelogram', chevron: 'chevron', homePlate: 'homePlate',
  cloud: 'cloud', heart: 'heart',
};

function textRuns(paras) {
  const out = [];
  paras.forEach((p, pi) => {
    const runs = p.runs.filter((r) => !r.br).length ? p.runs : [{ text: '' }];
    const pOpts = { align: p.align || 'left' };
    if (p.bullet === 'number') pOpts.bullet = { type: 'number' };
    else if (p.bullet) pOpts.bullet = true;
    if (p.level) pOpts.indentLevel = p.level;
    runs.forEach((r, ri) => {
      if (r.br) { out.push({ text: '', options: { ...pOpts, breakLine: true } }); return; }
      const o = { ...pOpts };
      if (r.size) o.fontSize = r.size;
      if (r.color) o.color = hex(r.color);
      if (r.font) o.fontFace = r.font;
      if (r.b) o.bold = true;
      if (r.i) o.italic = true;
      if (r.u) o.underline = { style: 'sng' };
      if (r.s) o.strike = 'sngStrike';
      if (ri === runs.length - 1 && pi < paras.length - 1) o.breakLine = true;
      out.push({ text: r.text, options: o });
    });
  });
  return out;
}

async function modelToPptx(model) {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'OS_LAYOUT', width: model.width, height: model.height });
  pptx.layout = 'OS_LAYOUT';
  pptx.author = 'OfficeStudio';
  pptx.title = model.title || 'Презентация';

  for (const s of model.slides) {
    const slide = pptx.addSlide();
    if (s.backgroundImage) slide.background = { data: imgData(s.backgroundImage) };
    else slide.background = { color: hex(s.background || '#ffffff') };

    for (const el of s.elements) {
      const pos = { x: el.x, y: el.y, w: Math.max(el.w, 0.01), h: Math.max(el.h, 0.01) };
      if (el.rot) pos.rotate = el.rot;
      if (el.type === 'ink') {
        const kx = el.w / (el.vw || el.w), ky = el.h / (el.vh || el.h);
        const points = [];
        for (const path of el.paths) path.forEach(([x, y], i) => points.push({ x: Math.max(0, x * kx), y: Math.max(0, y * ky), ...(i === 0 ? { moveTo: true } : {}) }));
        slide.addShape('custGeom', { ...pos, points, line: { color: hex(el.color || '#e5262b'), width: el.width || 3 }, fill: { color: 'FFFFFF', transparency: 100 } });
      } else if (el.type === 'image') {
        slide.addImage({ data: imgData(el.data), ...pos });
      } else if (el.type === 'table') {
        const rows = el.rows.map((row) => row.map((c) => ({
          text: c.text,
          options: { fill: c.fill ? { color: hex(c.fill) } : undefined, bold: !!c.b, fontSize: c.size || 14, color: hex(c.color || '#000000') },
        })));
        slide.addTable(rows, { x: el.x, y: el.y, w: el.w, colW: el.cols && el.cols.length === (el.rows[0] || []).length ? el.cols : undefined, border: { type: 'solid', pt: 1, color: '9CA3AF' }, valign: 'middle' });
      } else if (el.type === 'box') {
        const shape = GEOM[el.geom] || 'rect';
        const opts = { ...pos, shape };
        if (el.fill) opts.fill = { color: hex(el.fill) };
        if (el.line) opts.line = { color: hex(el.line.color), width: el.line.width || 1 };
        if (el.flipH) opts.flipH = true;
        if (el.flipV) opts.flipV = true;
        if (el.geom === 'roundRect') opts.rectRadius = Math.min(pos.w, pos.h) * 0.1667;
        const hasText = el.paras && el.paras.some((p) => p.runs.some((r) => (r.text || '').length));
        if (!hasText && !el.fill && !el.line) continue; // empty placeholder
        if (hasText) {
          opts.valign = el.valign || 'top';
          opts.margin = 5;
          opts.fit = 'none';
          slide.addText(textRuns(el.paras), opts);
        } else {
          slide.addShape(shape, opts);
        }
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const out = await pptx.write({ outputType: 'nodebuffer' });
  return Buffer.from(out);
}

module.exports = { modelToPptx };
