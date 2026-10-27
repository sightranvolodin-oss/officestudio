// DOCX <-> HTML conversion (runs in the Electron main process / Node)
const mammoth = require('mammoth');
const HTMLtoDOCX = require('html-to-docx');
const { docxToHtmlNative, docxMeta } = require('./docx-read');
const JSZip = require('jszip');

const INLINE = '(?:b|strong|i|em|u|s|span|a|sub|sup)';

const STYLE_MAP = [
  'u => u',
  'strike => s',
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => h2.subtitle:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
  "p[style-name='Intense Quote'] => blockquote:fresh",
];

async function docxToHtml(buffer) {
  try {
    const html = await docxToHtmlNative(buffer);
    let meta = null;
    try { meta = await docxMeta(buffer); } catch {}
    return { html, warnings: [], meta };
  } catch (e) {
    const fb = await docxToHtmlMammoth(buffer);
    fb.warnings.unshift('Использован упрощённый режим чтения: ' + e.message);
    return fb;
  }
}

async function docxToHtmlMammoth(buffer) {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: STYLE_MAP,
      convertImage: mammoth.images.imgElement(async (image) => {
        const b64 = await image.read('base64');
        return { src: `data:${image.contentType};base64,${b64}` };
      }),
    }
  );
  const warnings = result.messages
    .filter((m) => m.type === 'warning')
    .map((m) => m.message);
  return { html: result.value || '<p></p>', warnings };
}

// ---------------------------------------------------------------- paragraph geometry
// html-to-docx knows margin-left/right only. First-line / hanging indent and spacing before /
// after / line spacing are carried through it as a text marker at the start of the paragraph
// and turned into <w:ind>/<w:spacing> afterwards (applyParaMarkers).
const MARK_RE = /\[\[OSP:([^\]]*)\]\]/;
function toTwips(v) {
  const m = /^(-?[\d.]+)\s*(px|pt|cm|mm|in)?$/i.exec(String(v).trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'px').toLowerCase();
  return Math.round(n * { px: 15, pt: 20, cm: 566.93, mm: 56.693, in: 1440 }[u]);
}
function paraMarker(style) {
  const get = (name) => { const m = new RegExp('(?:^|;)\\s*' + name + '\\s*:\\s*([^;]+)', 'i').exec(style); return m ? m[1].trim() : null; };
  const parts = [];
  const ti = get('text-indent');
  if (ti != null) { const t = toTwips(ti); if (t) parts.push('fl=' + t); }
  const mt = get('margin-top');
  if (mt != null) { const t = toTwips(mt); if (t != null) parts.push('sb=' + Math.max(0, t)); }
  const mb = get('margin-bottom');
  if (mb != null) { const t = toTwips(mb); if (t != null) parts.push('sa=' + Math.max(0, t)); }
  const lh = get('line-height');
  if (lh != null) {
    if (/^[\d.]+$/.test(lh)) parts.push('ls=' + Math.round(parseFloat(lh) * 240));
    else { const t = toTwips(lh); if (t) parts.push('lx=' + t); }
  }
  return parts.length ? `[[OSP:${parts.join(';')}]]` : '';
}
function addParaMarkers(html) {
  return html.replace(/<(p|h[1-6]|li|blockquote)\b([^>]*?)\bstyle="([^"]*)"([^>]*)>/gi, (m, tag, a, style, b) => {
    const mk = paraMarker(style);
    return mk ? m + mk : m;
  });
}
function applyParaMarkers(xml) {
  if (!MARK_RE.test(xml)) return xml;
  const PPR_AFTER = /<w:(?:contextualSpacing|mirrorIndents|suppressOverlap|jc|textDirection|textAlignment|textboxTightWrap|outlineLvl|divId|cnfStyle|rPr|sectPr|pPrChange)\b/;
  let guard = 0;
  for (let m = MARK_RE.exec(xml); m && guard++ < 100000; m = MARK_RE.exec(xml)) {
    const at = m.index;
    const props = Object.fromEntries(m[1].split(';').filter(Boolean).map((kv) => kv.split('=')).map(([k, v]) => [k, +v]));
    xml = xml.slice(0, at) + xml.slice(at + m[0].length);
    // paragraph start
    let ps = at;
    for (;;) {
      ps = xml.lastIndexOf('<w:p', ps - 1);
      if (ps < 0) break;
      const ch = xml[ps + 4];
      if (ch === '>' || ch === ' ') break;
    }
    if (ps < 0) continue;
    let pOpenEnd = xml.indexOf('>', ps) + 1;
    while (/\s/.test(xml[pOpenEnd])) pOpenEnd++;
    let pprStart = xml.startsWith('<w:pPr>', pOpenEnd) ? pOpenEnd : -1;
    if (pprStart < 0) { xml = xml.slice(0, pOpenEnd) + '<w:pPr></w:pPr>' + xml.slice(pOpenEnd); pprStart = pOpenEnd; }
    const pprEnd = xml.indexOf('</w:pPr>', pprStart);
    let ppr = xml.slice(pprStart + 7, pprEnd);
    const setAttrs = (tag, attrs) => {
      const re = new RegExp(`<w:${tag}\\b([^>]*?)/>`);
      const ex = re.exec(ppr);
      let cur = ex ? ex[1] : '';
      for (const [k, v] of Object.entries(attrs)) {
        cur = cur.replace(new RegExp(`\\sw:${k}="[^"]*"`), '');
        if (v != null) cur += ` w:${k}="${v}"`;
      }
      const elx = `<w:${tag}${cur}/>`;
      if (ex) { ppr = ppr.replace(ex[0], elx); return; }
      // keep the schema order: spacing before ind, both before jc / rPr …
      let pos = ppr.search(PPR_AFTER);
      if (tag === 'spacing') { const ip = ppr.search(/<w:ind\b/); if (ip >= 0 && (pos < 0 || ip < pos)) pos = ip; }
      ppr = pos < 0 ? ppr + elx : ppr.slice(0, pos) + elx + ppr.slice(pos);
    };
    const sp = {};
    if (props.sb != null) sp.before = props.sb;
    if (props.sa != null) sp.after = props.sa;
    if (props.ls != null) { sp.line = props.ls; sp.lineRule = 'auto'; }
    if (props.lx != null) { sp.line = props.lx; sp.lineRule = 'exact'; }
    if (Object.keys(sp).length) setAttrs('spacing', sp);
    if (props.fl) setAttrs('ind', props.fl > 0 ? { firstLine: props.fl, hanging: null } : { hanging: -props.fl, firstLine: null });
    xml = xml.slice(0, pprStart + 7) + sortPPr(ppr) + xml.slice(pprEnd);
  }
  // runs that held only the marker
  return xml.replace(/<w:r>\s*(?:<w:rPr\/>|<w:rPr>(?:(?!<\/w:rPr>)[\s\S])*<\/w:rPr>)?\s*<w:t(?: xml:space="preserve")?><\/w:t>\s*<\/w:r>/g, '');
}

// Word is strict about the order of paragraph properties (CT_PPr sequence)
const PPR_ORDER = ['pStyle', 'keepNext', 'keepLines', 'pageBreakBefore', 'framePr', 'widowControl', 'numPr', 'suppressLineNumbers', 'pBdr', 'shd', 'tabs', 'suppressAutoHyphens', 'kinsoku', 'wordWrap', 'overflowPunct', 'topLinePunct', 'autoSpaceDE', 'autoSpaceDN', 'bidi', 'adjustRightInd', 'snapToGrid', 'spacing', 'ind', 'contextualSpacing', 'mirrorIndents', 'suppressOverlap', 'jc', 'textDirection', 'textAlignment', 'textboxTightWrap', 'outlineLvl', 'divId', 'cnfStyle', 'rPr', 'sectPr', 'pPrChange'];
function sortPPr(inner) {
  const items = [];
  let i = 0;
  const s = inner;
  while (i < s.length) {
    const lt = s.indexOf('<w:', i);
    if (lt < 0) break;
    const nm = /^<w:([A-Za-z]+)/.exec(s.slice(lt, lt + 40));
    if (!nm) { i = lt + 1; continue; }
    const name = nm[1];
    const gt = s.indexOf('>', lt);
    let end;
    if (s[gt - 1] === '/') end = gt + 1;
    else {
      // element with children: find its matching close tag (same name never nests inside pPr)
      const close = `</w:${name}>`;
      const ci = s.indexOf(close, gt);
      end = ci < 0 ? gt + 1 : ci + close.length;
    }
    items.push({ name, xml: s.slice(lt, end), k: items.length });
    i = end;
  }
  const rank = (n) => { const r = PPR_ORDER.indexOf(n); return r < 0 ? 999 : r; };
  items.sort((a, b) => rank(a.name) - rank(b.name) || a.k - b.k);
  return items.map((x) => x.xml).join('');
}

// html-to-docx works best with inline styles; normalise a few editor quirks first
function prepareHtml(html) {
  return addParaMarkers(html)
    // execCommand('fontSize') produces <font size=N>; map to point sizes
    .replace(/<font([^>]*)>/gi, (m, attrs) => {
      const styles = [];
      const size = /size="?(\d)"?/i.exec(attrs);
      const color = /color="?(#[0-9a-f]{3,6}|[a-z]+)"?/i.exec(attrs);
      const face = /face="([^"]+)"/i.exec(attrs);
      const sizes = { 1: 8, 2: 10, 3: 12, 4: 14, 5: 18, 6: 24, 7: 36 };
      if (size) styles.push(`font-size:${sizes[size[1]] || 12}pt`);
      if (color) styles.push(`color:${color[1]}`);
      if (face) styles.push(`font-family:${face[1]}`);
      return `<span style="${styles.join(';')}">`;
    })
    .replace(/<\/font>/gi, '</span>')
    .replace(/<div class="page-break"[^>]*>\s*<\/div>/gi, '<div class="page-break" style="page-break-after: always;"></div>')
    .replace(/<strike>/gi, '<s>')
    .replace(/<\/strike>/gi, '</s>')
    .replace(/&emsp;/g, ' ')
    // image sizes: html-to-docx only honours inline style width/height
    .replace(/<img\b([^>]*)>/gi, (m, attrs) => {
      if (/style="[^"]*width/i.test(attrs)) return m;
      const w = /\bwidth="?(\d+)/i.exec(attrs);
      const h = /\bheight="?(\d+)/i.exec(attrs);
      if (!w && !h) return m;
      const st = `${w ? `width:${w[1]}px;` : ''}${h ? `height:${h[1]}px;` : ''}`;
      return /style="/i.test(attrs) ? m.replace(/style="/i, `style="${st}`) : `<img${attrs} style="${st}">`;
    })
    // html-to-docx drops whitespace-only text nodes between inline tags ("</b> <i>") — move the space inside
    .replace(new RegExp(`(</${INLINE}>)(\\s+)(<${INLINE}\\b[^>]*>)`, 'gi'), '$1$3 ')
    .replace(new RegExp(`(</${INLINE}>)\\s+(</?(?:p|li|h\\d|td)\\b)`, 'gi'), '$1$2');
}

// [[OSPAGE]] / [[OSPAGES]] markers in headers and footers -> PAGE / NUMPAGES fields
async function fixPageFields(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(header|footer)\d*\.xml$/.test(name)) continue;
    let xml = await zip.file(name).async('string');
    if (!/\[\[OSPAGES?\]\]/.test(xml)) continue;
    // html-to-docx writes headers with a default namespace (<t>, <r>), the body with w: prefixes
    const w = /<w:t[ >]/.test(xml) ? 'w:' : '';
    xml = xml.replace(/\[\[OSPAGE(S?)\]\]/g, (m, s) => `</${w}t></${w}r><${w}fldSimple ${w}instr=" ${s ? 'NUMPAGES' : 'PAGE'} "><${w}r><${w}t>1</${w}t></${w}r></${w}fldSimple><${w}r><${w}t xml:space="preserve">`);
    zip.file(name, xml);
    changed = true;
  }
  return changed ? zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}

async function fixParagraphs(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const fixed = applyParaMarkers(xml);
  if (fixed === xml) return buffer;
  zip.file('word/document.xml', fixed);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const EMU_PX = 9525;

// Embed red-pencil strokes as floating pictures anchored to the paragraph that holds their token.
// The stroke data is kept in the picture's alt text so OfficeStudio can make it editable again.
async function embedInks(buffer, inks) {
  const zip = await JSZip.loadAsync(buffer);
  let xml = await zip.file('word/document.xml').async('string');
  const relsPath = 'word/_rels/document.xml.rels';
  let rels = await zip.file(relsPath).async('string');
  let ct = await zip.file('[Content_Types].xml').async('string');
  if (!/Extension="png"/i.test(ct)) ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
  inks.forEach((ink, i) => {
    const at = xml.indexOf(ink.token);
    if (at < 0) return;
    // find the start of the run that contains the token (<w:r> or <w:r ...>, not <w:rPr>)
    let runStart = at;
    for (;;) {
      runStart = xml.lastIndexOf('<w:r', runStart - 1);
      if (runStart < 0) break;
      const ch = xml[runStart + 4];
      if (ch === '>' || ch === ' ') break;
    }
    xml = xml.slice(0, at) + xml.slice(at + ink.token.length);
    if (runStart < 0) return;
    const rid = `rIdOsInk${i}`;
    zip.file(`word/media/osink${i}.png`, ink.png.split(',')[1], { base64: true });
    rels = rels.replace('</Relationships>', `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/osink${i}.png"/></Relationships>`);
    const cx = Math.max(1, Math.round(ink.w * EMU_PX)), cy = Math.max(1, Math.round(ink.h * EMU_PX));
    const id = 7000 + i;
    const run = `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251660000 + i}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`
      + '<wp:simplePos x="0" y="0"/>'
      + `<wp:positionH relativeFrom="margin"><wp:posOffset>${Math.round(ink.xMargin * EMU_PX)}</wp:posOffset></wp:positionH>`
      + `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${Math.round(ink.dy * EMU_PX)}</wp:posOffset></wp:positionV>`
      + `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>`
      + `<wp:docPr id="${id}" name="Пометка ${i + 1}" descr="${xmlEsc('OSINK:' + ink.meta)}"/><wp:cNvGraphicFramePr/>`
      + '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
      + `<pic:nvPicPr><pic:cNvPr id="${id}" name="osink${i}.png"/><pic:cNvPicPr/></pic:nvPicPr>`
      + `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
      + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>`
      + '</pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
    xml = xml.slice(0, runStart) + run + xml.slice(runStart);
  });
  zip.file('word/document.xml', xml);
  zip.file(relsPath, rels);
  zip.file('[Content_Types].xml', ct);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

const tw = (mm) => Math.round((mm / 25.4) * 1440);
const hfHtml = (text) => (text || '').split('\n').map((l) => `<p>${xmlEsc(l).replace(/\{PAGE\}/g, '[[OSPAGE]]').replace(/\{NUMPAGES\}/g, '[[OSPAGES]]') || '&nbsp;'}</p>`).join('');

async function htmlToDocx(html, meta = {}, inks = [], doc = null) {
  const d = doc || {};
  const pg = { w: 210, h: 297, mt: 25.4, mb: 25.4, ml: 23.8, mr: 23.8, ...(d.page || {}) };
  const header = d.header || '';
  const footer = d.footer || '';
  const prepared = prepareHtml(html);
  const buffer = await HTMLtoDOCX(prepared, header ? hfHtml(header) : null, {
    title: meta.title || 'Документ',
    creator: 'OfficeStudio',
    font: 'Calibri',
    fontSize: 22, // half-points => 11pt
    table: { row: { cantSplit: true } },
    pageNumber: false,
    lang: 'ru-RU',
    orientation: pg.w > pg.h ? 'landscape' : 'portrait',
    pageSize: { width: tw(Math.min(pg.w, pg.h)), height: tw(Math.max(pg.w, pg.h)) },
    margins: { top: tw(pg.mt), right: tw(pg.mr), bottom: tw(pg.mb), left: tw(pg.ml), header: 720, footer: 720, gutter: 0 },
    header: !!header,
    headerType: 'default',
    footer: !!footer,
    footerType: 'default',
  }, footer ? hfHtml(footer) : null);
  let out = Buffer.isBuffer(buffer) ? buffer : Buffer.from(await buffer.arrayBuffer());
  out = await fixParagraphs(out);
  if (header || footer) out = await fixPageFields(out);
  return inks && inks.length ? embedInks(out, inks) : out;
}

module.exports = { docxToHtml, htmlToDocx };
