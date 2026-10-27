// High-fidelity DOCX -> HTML reader (paragraph styles, alignment, run formatting,
// lists, tables, images, hyperlinks, page breaks). Falls back to mammoth on error.
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const kids = (el, local) => {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!local || n.localName === local)) out.push(n);
  return out;
};
const kid = (el, local) => kids(el, local)[0] || null;
const wattr = (el, name) => (el ? el.getAttributeNS(W, name) || el.getAttribute('w:' + name) || null : null);
const parse = (xml) => new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');

const HIGHLIGHT = {
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000',
  darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000',
  darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff',
};
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

async function docxToHtmlNative(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('Не найден word/document.xml — файл повреждён или это не DOCX');
  const doc = parse(docXml);

  // relationships (images, links)
  const rels = {};
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (relsXml) for (const r of Array.from(parse(relsXml).getElementsByTagName('Relationship')))
    rels[r.getAttribute('Id')] = { target: r.getAttribute('Target'), mode: r.getAttribute('TargetMode') };

  // styles: map styleId -> heading level / name
  const styles = {};
  const stylesXml = await zip.file('word/styles.xml')?.async('string');
  if (stylesXml) {
    for (const s of Array.from(parse(stylesXml).getElementsByTagNameNS(W, 'style'))) {
      const id = wattr(s, 'styleId');
      const name = (wattr(kid(s, 'name'), 'val') || '').toLowerCase();
      const outline = wattr(kid(kid(s, 'pPr'), 'outlineLvl'), 'val');
      let level = null;
      const m = /^heading\s*(\d)$/.exec(name) || /^заголовок\s*(\d)$/.exec(name);
      if (m) level = +m[1];
      else if (outline != null && +outline < 6) level = +outline + 1;
      if (name === 'title') level = 1;
      const np = kid(kid(s, 'pPr'), 'numPr');
      const numPr = np ? { numId: wattr(kid(np, 'numId'), 'val'), ilvl: wattr(kid(np, 'ilvl'), 'val') } : null;
      styles[id] = { name, level, quote: /quote/.test(name), numPr, basedOn: wattr(kid(s, 'basedOn'), 'val') };
    }
    // inherit list numbering through basedOn chains
    for (const id of Object.keys(styles)) {
      let s = styles[id], guard = 0;
      while (!styles[id].numPr && s.basedOn && styles[s.basedOn] && guard++ < 10) {
        s = styles[s.basedOn];
        if (s.numPr) styles[id].numPr = s.numPr;
      }
    }
  }

  // numbering: numId -> ilvl -> numFmt
  const numFmt = {};
  const numXml = await zip.file('word/numbering.xml')?.async('string');
  if (numXml) {
    const nd = parse(numXml);
    const abs = {};
    for (const a of Array.from(nd.getElementsByTagNameNS(W, 'abstractNum'))) {
      const lv = {};
      for (const l of kids(a, 'lvl')) lv[wattr(l, 'ilvl')] = wattr(kid(l, 'numFmt'), 'val');
      abs[wattr(a, 'abstractNumId')] = lv;
    }
    for (const n of Array.from(nd.getElementsByTagNameNS(W, 'num')))
      numFmt[wattr(n, 'numId')] = abs[wattr(kid(n, 'abstractNumId'), 'val')] || {};
  }

  const imageCache = {};
  async function imageSrc(rId) {
    if (imageCache[rId]) return imageCache[rId];
    const rel = rels[rId];
    if (!rel) return null;
    let p = rel.target.replace(/^\//, '');
    if (!p.startsWith('word/')) p = 'word/' + p;
    p = p.replace(/\/[^/]+\/\.\.\//g, '/');
    const f = zip.file(p);
    if (!f) return null;
    const ext = p.split('.').pop().toLowerCase();
    if (ext === 'emf' || ext === 'wmf') return null; // not renderable in Chromium
    const src = `data:${MIME[ext] || 'image/png'};base64,${await f.async('base64')}`;
    imageCache[rId] = src;
    return src;
  }

  function runStyle(rPr) {
    if (!rPr) return { open: '', close: '' };
    const css = [];
    let open = '', close = '';
    const on = (el) => el && wattr(el, 'val') !== '0' && wattr(el, 'val') !== 'false';
    const wrap = (tag) => { open += `<${tag}>`; close = `</${tag}>` + close; };
    if (on(kid(rPr, 'b'))) wrap('b');
    if (on(kid(rPr, 'i'))) wrap('i');
    const u = kid(rPr, 'u');
    if (u && wattr(u, 'val') !== 'none') wrap('u');
    if (on(kid(rPr, 'strike')) || on(kid(rPr, 'dstrike'))) wrap('s');
    const va = wattr(kid(rPr, 'vertAlign'), 'val');
    if (va === 'superscript') wrap('sup');
    if (va === 'subscript') wrap('sub');
    const color = wattr(kid(rPr, 'color'), 'val');
    if (color && color !== 'auto' && /^[0-9a-f]{6}$/i.test(color)) css.push(`color:#${color}`);
    const sz = wattr(kid(rPr, 'sz'), 'val');
    if (sz) css.push(`font-size:${+sz / 2}pt`);
    const fonts = kid(rPr, 'rFonts');
    const face = fonts && (wattr(fonts, 'ascii') || wattr(fonts, 'hAnsi') || wattr(fonts, 'cs'));
    if (face) css.push(`font-family:'${face.replace(/'/g, '')}'`);
    const hl = wattr(kid(rPr, 'highlight'), 'val');
    if (hl && HIGHLIGHT[hl]) css.push(`background-color:${HIGHLIGHT[hl]}`);
    const shd = kid(rPr, 'shd');
    const fill = shd && wattr(shd, 'fill');
    if (!hl && fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== 'ffffff') css.push(`background-color:#${fill}`);
    if (css.length) { open = `<span style="${css.join(';')}">` + open; close = close + '</span>'; }
    return { open, close };
  }

  async function renderRun(r) {
    const { open, close } = runStyle(kid(r, 'rPr'));
    let inner = '';
    for (const c of kids(r)) {
      switch (c.localName) {
        case 't': inner += esc(c.textContent); break;
        case 'tab': inner += '&emsp;'; break;
        case 'br':
          if (wattr(c, 'type') === 'page') inner += '</p><div class="page-break"></div><p>';
          else inner += '<br>';
          break;
        case 'drawing': {
          const docPr = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'docPr')[0];
          const descr = docPr && docPr.getAttribute('descr');
          if (descr && descr.startsWith('OSINK:')) { inner += `<span class="os-ink" data-ink="${esc(descr.slice(6))}"></span>`; break; }
          const blip = c.getElementsByTagNameNS(A, 'blip')[0];
          const rId = blip && (blip.getAttributeNS(R, 'embed') || blip.getAttribute('r:embed'));
          const ext = c.getElementsByTagNameNS('http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing', 'extent')[0];
          const src = rId && (await imageSrc(rId));
          if (src) {
            const w = ext ? Math.round(+ext.getAttribute('cx') / 9525) : null;
            const h = ext ? Math.round(+ext.getAttribute('cy') / 9525) : null;
            inner += `<img src="${src}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}>`;
          }
          break;
        }
        case 'pict': {
          const im = c.getElementsByTagName('v:imagedata')[0];
          const rId = im && (im.getAttributeNS(R, 'id') || im.getAttribute('r:id'));
          const src = rId && (await imageSrc(rId));
          if (src) inner += `<img src="${src}">`;
          break;
        }
        default: break;
      }
    }
    return inner ? open + inner + close : '';
  }

  async function renderInline(p) {
    let html = '';
    for (const c of kids(p)) {
      if (c.localName === 'r') html += await renderRun(c);
      else if (c.localName === 'hyperlink') {
        const rId = c.getAttributeNS(R, 'id') || c.getAttribute('r:id');
        const href = rId && rels[rId] ? rels[rId].target : '#';
        let inner = '';
        for (const r of kids(c, 'r')) inner += await renderRun(r);
        html += `<a href="${esc(href)}">${inner}</a>`;
      } else if (c.localName === 'ins' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'fldSimple') {
        const content = c.localName === 'sdt' ? kid(c, 'sdtContent') : c;
        html += await renderInline(content);
      }
    }
    return html;
  }

  // returns { kind: 'p'|'li', html, list: {numId, ilvl, ordered} }
  async function renderParagraph(p) {
    const pPr = kid(p, 'pPr');
    const styleId = wattr(kid(pPr, 'pStyle'), 'val');
    const st = styles[styleId] || {};
    const css = [];
    const jc = wattr(kid(pPr, 'jc'), 'val');
    const align = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc];
    if (align) css.push(`text-align:${align}`);
    const ind = kid(pPr, 'ind');
    const left = ind && (wattr(ind, 'left') || wattr(ind, 'start'));
    const right = ind && (wattr(ind, 'right') || wattr(ind, 'end'));
    const numPr = kid(pPr, 'numPr');
    if (left && !numPr && +left > 0) css.push(`margin-left:${Math.round(+left / 15)}px`);
    if (right && +right > 0) css.push(`margin-right:${Math.round(+right / 15)}px`);
    const first = ind && wattr(ind, 'firstLine');
    const hanging = ind && wattr(ind, 'hanging');
    if (hanging && +hanging > 0 && !numPr) css.push(`text-indent:-${Math.round(+hanging / 15)}px`);
    else if (first && +first > 0) css.push(`text-indent:${Math.round(+first / 15)}px`);
    const spacing = kid(pPr, 'spacing');
    if (spacing) {
      const before = wattr(spacing, 'before'), after = wattr(spacing, 'after');
      const line = wattr(spacing, 'line'), rule = wattr(spacing, 'lineRule');
      if (before != null && before !== '') css.push(`margin-top:${+(+before / 20).toFixed(1)}pt`);
      if (after != null && after !== '') css.push(`margin-bottom:${+(+after / 20).toFixed(1)}pt`);
      if (line && +line > 0) css.push(!rule || rule === 'auto' ? `line-height:${+(+line / 240).toFixed(2)}` : `line-height:${+(+line / 20).toFixed(1)}pt`);
    }
    let inner = await renderInline(p);
    if (!inner.replace(/<[^>]+>/g, '').trim() && !/<img|<br/.test(inner)) inner = inner || '<br>';
    const style = css.length ? ` style="${css.join(';')}"` : '';

    if (numPr || st.numPr) {
      const numId = wattr(kid(numPr, 'numId'), 'val') || (st.numPr && st.numPr.numId);
      const ilvl = +(wattr(kid(numPr, 'ilvl'), 'val') || (st.numPr && st.numPr.ilvl) || 0);
      if (numId && numId !== '0') {
        const fmt = (numFmt[numId] || {})[String(ilvl)] || 'bullet';
        return { kind: 'li', html: `<li${style}>${inner}</li>`, list: { numId, ilvl, ordered: fmt !== 'bullet' && fmt !== 'none' } };
      }
    }
    let tag = 'p';
    if (st.level) tag = 'h' + Math.min(st.level, 6);
    else if (st.quote) tag = 'blockquote';
    return { kind: 'p', html: `<${tag}${style}>${inner}</${tag}>` };
  }

  async function renderTable(tbl) {
    let html = '<table>';
    for (const tr of kids(tbl, 'tr')) {
      html += '<tr>';
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = wattr(kid(tcPr, 'gridSpan'), 'val');
        const vm = kid(tcPr, 'vMerge');
        if (vm && wattr(vm, 'val') !== 'restart') { continue; }
        const shd = wattr(kid(tcPr, 'shd'), 'fill');
        const st = shd && /^[0-9a-f]{6}$/i.test(shd) ? ` style="background-color:#${shd}"` : '';
        html += `<td${span ? ` colspan="${span}"` : ''}${st}>${await renderBlocks(tc)}</td>`;
      }
      html += '</tr>';
    }
    return html + '</table>';
  }

  async function renderBlocks(container) {
    let html = '';
    const stack = []; // open lists: {tag, numId}
    const closeTo = (depth) => { while (stack.length > depth) html += `</${stack.pop().tag}>`; };
    for (const el of kids(container)) {
      if (el.localName === 'p') {
        const r = await renderParagraph(el);
        if (r.kind === 'li') {
          const tag = r.list.ordered ? 'ol' : 'ul';
          const depth = r.list.ilvl + 1;
          closeTo(depth);
          if (stack.length === depth && stack[depth - 1].tag !== tag) closeTo(depth - 1);
          while (stack.length < depth) { html += `<${tag}>`; stack.push({ tag }); }
          html += r.html;
        } else {
          closeTo(0);
          html += r.html;
        }
      } else if (el.localName === 'tbl') {
        closeTo(0);
        html += await renderTable(el);
      } else if (el.localName === 'sdt') {
        closeTo(0);
        html += await renderBlocks(kid(el, 'sdtContent'));
      }
    }
    closeTo(0);
    return html;
  }

  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  let html = await renderBlocks(body);
  html = html.replace(/<p([^>]*)><\/p><div class="page-break"><\/div>/g, '<div class="page-break"></div>')
             .replace(/<div class="page-break"><\/div><p([^>]*)><\/p>/g, '<div class="page-break"></div>');
  return html || '<p><br></p>';
}

module.exports = { docxToHtmlNative };
