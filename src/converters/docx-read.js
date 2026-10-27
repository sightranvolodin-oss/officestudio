// High-fidelity DOCX -> HTML reader (paragraph styles, alignment, run formatting,
// lists, tables, images, hyperlinks, page breaks). Falls back to mammoth on error.
const JSZip = require('jszip');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const OSMath = require('../renderer/math.js');

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
const MIME = { wmf: 'image/x-wmf', emf: 'image/x-emf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff' };

/** w:sym characters from Symbol / Wingdings fonts (code points F0xx) -> Unicode */
const SYMBOL = { 0x61: 'α', 0x62: 'β', 0x63: 'χ', 0x64: 'δ', 0x65: 'ε', 0x66: 'φ', 0x67: 'γ', 0x68: 'η', 0x69: 'ι', 0x6A: 'ϕ', 0x6B: 'κ', 0x6C: 'λ', 0x6D: 'μ', 0x6E: 'ν', 0x6F: 'ο', 0x70: 'π', 0x71: 'θ', 0x72: 'ρ', 0x73: 'σ', 0x74: 'τ', 0x75: 'υ', 0x76: 'ϖ', 0x77: 'ω', 0x78: 'ξ', 0x79: 'ψ', 0x7A: 'ζ', 0x41: 'Α', 0x42: 'Β', 0x43: 'Χ', 0x44: 'Δ', 0x45: 'Ε', 0x46: 'Φ', 0x47: 'Γ', 0x48: 'Η', 0x49: 'Ι', 0x4B: 'Κ', 0x4C: 'Λ', 0x4D: 'Μ', 0x4E: 'Ν', 0x4F: 'Ο', 0x50: 'Π', 0x51: 'Θ', 0x52: 'Ρ', 0x53: 'Σ', 0x54: 'Τ', 0x55: 'Υ', 0x57: 'Ω', 0x58: 'Ξ', 0x59: 'Ψ', 0x5A: 'Ζ', 0xA3: '≤', 0xB3: '≥', 0xB9: '≠', 0xBB: '≈', 0xB1: '±', 0xB4: '×', 0xB8: '÷', 0xD7: '·', 0xB7: '•', 0xA5: '∞', 0xB0: '°', 0xAE: '→', 0xAC: '←', 0xAD: '↑', 0xAF: '↓', 0xDE: '⇒', 0xDB: '⇔', 0xD6: '√', 0xE5: '∑', 0xF2: '∫', 0xB6: '∂', 0xD1: '∇', 0xCE: '∈', 0xC7: '∩', 0xC8: '∪', 0xA2: '′', 0xB2: '″', 0xBE: '—', 0xBC: '…', 0x2D: '−', 0x2B: '+', 0x3D: '=', 0x28: '(', 0x29: ')' };
function symbolChar(code, font) {
  const c = code >= 0xF000 ? code - 0xF000 : code;
  if (/symbol/.test(font) && SYMBOL[c]) return SYMBOL[c];
  if (/wingdings/.test(font)) return { 0xFC: '✓', 0xFB: '✗', 0xA8: '☐', 0xFE: '☑', 0x9F: '•', 0x6C: '●', 0x6E: '■', 0xD8: '➢', 0xE0: '→' }[c] || '•';
  return String.fromCodePoint(code >= 0xF000 && !font ? c : code);
}

/** Word equation -> editable span: MathML to show it, the original OMML to save it back unchanged */
function mathHtml(node) {
  let mathml = '';
  try { mathml = OSMath.ommlToMathml(node); } catch { mathml = `<math><mtext>${esc(node.textContent)}</mtext></math>`; }
  const omml = new XMLSerializer().serializeToString(node);
  const display = node.localName === 'oMathPara';
  return `<span class="os-math${display ? ' os-math-block' : ''}" contenteditable="false" data-omml="${esc(omml)}">${mathml}</span>`;
}

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

  // footnotes and endnotes: shown as numbered notes at the end of the document
  const notes = { footnote: {}, endnote: {} };
  for (const kind of ['footnote', 'endnote']) {
    const x = await zip.file(`word/${kind}s.xml`)?.async('string');
    if (!x) continue;
    for (const n of Array.from(parse(x).getElementsByTagNameNS(W, kind))) {
      const id = wattr(n, 'id');
      if (wattr(n, 'type')) continue; // separators
      notes[kind][id] = n;
    }
  }
  const usedNotes = [];

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
    // WMF/EMF (MathType and old Equation objects, Visio…) are drawn to PNG by the editor
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
    if (on(kid(rPr, 'caps'))) css.push('text-transform:uppercase');
    else if (on(kid(rPr, 'smallCaps'))) css.push('font-variant:small-caps');
    const spc = wattr(kid(rPr, 'spacing'), 'val');
    if (spc && +spc) css.push(`letter-spacing:${(+spc / 20).toFixed(1)}pt`);
    if (css.length) { open = `<span style="${css.join(';')}">` + open; close = close + '</span>'; }
    return { open, close, hidden: on(kid(rPr, 'vanish')) };
  }

  async function renderRun(r) {
    const { open, close, hidden } = runStyle(kid(r, 'rPr'));
    if (hidden) return '';
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
          const tbx = c.getElementsByTagNameNS(W, 'txbxContent')[0];
          if (tbx) { inner += await textBox(tbx); break; }
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
        case 'pict': case 'object': {
          // text boxes (VML)
          const tb = c.getElementsByTagNameNS(W, 'txbxContent')[0];
          if (tb) { inner += await textBox(tb); break; }
          // embedded objects (MathType / Equation 3.0, Visio, Excel…) and VML pictures: their preview image
          const im = c.getElementsByTagName('v:imagedata')[0];
          const rId = im && (im.getAttributeNS(R, 'id') || im.getAttribute('r:id'));
          const src = rId && (await imageSrc(rId));
          const shape = c.getElementsByTagName('v:shape')[0];
          const style = (shape && shape.getAttribute('style')) || '';
          const dim = (k) => { const m = new RegExp(k + ':\\s*([\\d.]+)(pt|in|px|cm|mm)?').exec(style); if (!m) return null; const v = +m[1]; return Math.round(v * ({ pt: 96 / 72, in: 96, px: 1, cm: 96 / 2.54, mm: 96 / 25.4 }[m[2] || 'px'])); };
          const w = dim('width'), h = dim('height');
          if (src) inner += `<img src="${src}"${w ? ` width="${w}"` : ''}${h ? ` height="${h}"` : ''}${c.localName === 'object' ? ' class="os-ole"' : ''}>`;
          break;
        }
        case 'sym': {
          const ch = parseInt(wattr(c, 'char') || '0', 16);
          const font = (wattr(c, 'font') || '').toLowerCase();
          inner += esc(symbolChar(ch, font));
          break;
        }
        case 'footnoteReference': case 'endnoteReference': {
          const kind = c.localName === 'footnoteReference' ? 'footnote' : 'endnote';
          const id = wattr(c, 'id');
          if (notes[kind][id]) { usedNotes.push({ kind, id }); inner += `<sup class="os-fn">${usedNotes.length}</sup>`; }
          break;
        }
        case 'noBreakHyphen': inner += '‑'; break;
        case 'softHyphen': inner += '&shy;'; break;
        case 'cr': inner += '<br>'; break;
        default: break;
      }
    }
    return inner ? open + inner + close : '';
  }

  /** a text box / shape with text: its paragraphs as an inline framed block */
  async function textBox(tb) {
    const parts = [];
    for (const p of kids(tb, 'p')) { const t = await renderInline(p); parts.push(t || '&nbsp;'); }
    return `<span class="os-textbox">${parts.join('<br>')}</span>`;
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
      } else if (c.localName === 'oMath' || c.localName === 'oMathPara') {
        html += mathHtml(c);
      } else if (c.localName === 'ins' || c.localName === 'moveTo' || c.localName === 'smartTag' || c.localName === 'sdt' || c.localName === 'fldSimple' || c.localName === 'customXml' || c.localName === 'dir' || c.localName === 'bdo') {
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
    // borders and shading of the paragraph
    const pBdr = kid(pPr, 'pBdr');
    if (pBdr) for (const [k, side] of [['top', 'top'], ['bottom', 'bottom'], ['left', 'left'], ['right', 'right']]) {
      const b = kid(pBdr, k);
      const v = b && wattr(b, 'val');
      if (v && v !== 'none' && v !== 'nil') { const col = wattr(b, 'color'); css.push(`border-${side}:${Math.max(1, Math.round((+wattr(b, 'sz') || 4) / 6))}px ${/double/.test(v) ? 'double' : /dash|dot/.test(v) ? 'dashed' : 'solid'} ${col && /^[0-9a-f]{6}$/i.test(col) ? '#' + col : '#000'}`); }
    }
    const pshd = wattr(kid(pPr, 'shd'), 'fill');
    if (pshd && /^[0-9a-f]{6}$/i.test(pshd) && pshd.toLowerCase() !== 'ffffff') css.push(`background-color:#${pshd}`);
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
    const pbb = kid(pPr, 'pageBreakBefore');
    const breakBefore = pbb && wattr(pbb, 'val') !== '0' && wattr(pbb, 'val') !== 'false' ? '<div class="page-break"></div>' : '';
    if (st.level) tag = 'h' + Math.min(st.level, 6);
    else if (st.quote) tag = 'blockquote';
    return { kind: 'p', html: `${breakBefore}<${tag}${style}>${inner}</${tag}>` };
  }

  async function renderTable(tbl) {
    // grid positions of every cell, so vertically merged cells get a rowspan
    const rows = kids(tbl, 'tr').map((tr) => {
      let col = 0;
      return kids(tr, 'tc').map((tc) => {
        const tcPr = kid(tc, 'tcPr');
        const span = +(wattr(kid(tcPr, 'gridSpan'), 'val') || 1);
        const vm = kid(tcPr, 'vMerge');
        const cell = { tc, tcPr, col, span, cont: !!(vm && wattr(vm, 'val') !== 'restart'), rowspan: 1 };
        col += span;
        return cell;
      });
    });
    rows.forEach((row, ri) => row.forEach((c) => {
      if (c.cont) return;
      for (let k = ri + 1; k < rows.length; k++) {
        const below = rows[k].find((x) => x.col === c.col);
        if (below && below.cont) c.rowspan++; else break;
      }
    }));
    let html = '<table>';
    for (const row of rows) {
      html += '<tr>';
      for (const c of row) {
        if (c.cont) continue;
        const shd = wattr(kid(c.tcPr, 'shd'), 'fill');
        const w = kid(c.tcPr, 'tcW');
        const css = [];
        if (shd && /^[0-9a-f]{6}$/i.test(shd)) css.push(`background-color:#${shd}`);
        if (w && wattr(w, 'type') === 'dxa' && +wattr(w, 'w') > 0) css.push(`width:${Math.round(+wattr(w, 'w') / 15)}px`);
        const va = wattr(kid(c.tcPr, 'vAlign'), 'val');
        if (va === 'center' || va === 'bottom') css.push(`vertical-align:${va === 'center' ? 'middle' : 'bottom'}`);
        html += `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}${css.length ? ` style="${css.join(';')}"` : ''}>${await renderBlocks(c.tc)}</td>`;
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
  // notes at the end, numbered in the order of their references
  if (usedNotes.length) {
    let notesHtml = '<hr><p style="font-size:9pt"><b>Сноски</b></p>';
    for (let i = 0; i < usedNotes.length; i++) {
      const n = notes[usedNotes[i].kind][usedNotes[i].id];
      let t = '';
      for (const p of kids(n, 'p')) t += (t ? ' ' : '') + (await renderInline(p));
      notesHtml += `<p style="font-size:9pt;margin:0 0 2pt"><sup>${i + 1}</sup> ${t.replace(/<sup class="os-fn">\d+<\/sup>/g, '')}</p>`;
    }
    html += notesHtml;
  }
  html = html.replace(/<p([^>]*)><\/p><div class="page-break"><\/div>/g, '<div class="page-break"></div>')
             .replace(/<div class="page-break"><\/div><p([^>]*)><\/p>/g, '<div class="page-break"></div>');
  return html || '<p><br></p>';
}

/** Page setup, headers and footers: { page: {w, h, mt, mb, ml, mr} (mm), header, footer, pnum } */
async function docxMeta(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) return null;
  const doc = parse(docXml);
  const sects = doc.getElementsByTagNameNS(W, 'sectPr');
  const sect = sects[sects.length - 1];
  const mm = (tw) => (tw != null && tw !== '' ? Math.round((+tw / 1440) * 25.4 * 10) / 10 : null);
  const meta = { page: { w: 210, h: 297, mt: 25.4, mb: 25.4, ml: 23.8, mr: 23.8 }, header: '', footer: '', pnum: '' };
  if (sect) {
    const sz = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
    if (sz) { meta.page.w = mm(wattr(sz, 'w')) || 210; meta.page.h = mm(wattr(sz, 'h')) || 297; }
    if (mar) for (const [k, a] of [['mt', 'top'], ['mb', 'bottom'], ['ml', 'left'], ['mr', 'right']]) { const v = mm(wattr(mar, a)); if (v != null) meta.page[k] = Math.abs(v); }
  }
  // default header / footer text, with page number fields as {PAGE} / {NUMPAGES}
  const rels = {};
  const relsXml = await zip.file('word/_rels/document.xml.rels')?.async('string');
  if (relsXml) for (const r of Array.from(parse(relsXml).getElementsByTagName('Relationship'))) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  const partText = async (target) => {
    const f = zip.file('word/' + target.replace(/^\/?word\//, ''));
    if (!f) return '';
    const x = parse(await f.async('string'));
    const paras = [];
    const firstP = x.getElementsByTagNameNS(W, 'p')[0];
    const jc = firstP && wattr(kid(kid(firstP, 'pPr'), 'jc'), 'val');
    partText.align = { center: 'center', right: 'right', end: 'right', left: 'left', start: 'left' }[jc] || 'left';
    for (const p of Array.from(x.getElementsByTagNameNS(W, 'p'))) {
      let t = '';
      let inField = null;
      const walk = (n) => {
        for (let c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          const ln = c.localName;
          if (ln === 'fldSimple') { const ins = (wattr(c, 'instr') || c.getAttribute('instr') || '').trim().split(/\s+/)[0].toUpperCase(); t += ins === 'PAGE' ? '{PAGE}' : ins === 'NUMPAGES' ? '{NUMPAGES}' : ''; continue; }
          if (ln === 'fldChar') { const ty = wattr(c, 'fldCharType'); if (ty === 'begin') inField = ''; else if (ty === 'separate') { const ins = (inField || '').trim().split(/\s+/)[0].toUpperCase(); t += ins === 'PAGE' ? '{PAGE}' : ins === 'NUMPAGES' ? '{NUMPAGES}' : ''; inField = 'skip'; } else if (ty === 'end') inField = null; continue; }
          if (ln === 'instrText') { if (inField !== null && inField !== 'skip') inField += c.textContent; continue; }
          if (ln === 't') { if (inField === null) t += c.textContent; continue; }
          if (ln === 'tab') { t += '\t'; continue; }
          walk(c);
        }
      };
      walk(p);
      paras.push(t);
    }
    return paras.join('\n').trim();
  };
  if (sect) {
    for (const kind of ['header', 'footer']) {
      const refs = kids(sect, kind + 'Reference');
      const ref = refs.find((r) => wattr(r, 'type') === 'default') || refs[0];
      const id = ref && (ref.getAttributeNS(R, 'id') || ref.getAttribute('r:id'));
      if (id && rels[id]) { meta[kind] = await partText(rels[id]); meta[kind + 'Align'] = partText.align; }
    }
  }
  return meta;
}

module.exports = { docxToHtmlNative, docxMeta };
