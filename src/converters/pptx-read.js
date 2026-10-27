// PPTX -> editable slide model. Units: inches. Colours: '#RRGGBB'.
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const NS = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
};
const EMU = 914400;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };

const parse = (xml) => new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml');
const kids = (el, local) => {
  const out = [];
  if (!el) return out;
  for (let n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 1 && (!local || n.localName === local)) out.push(n);
  return out;
};
const kid = (el, local) => kids(el, local)[0] || null;
const path = (el, ...locals) => { let c = el; for (const l of locals) { c = kid(c, l); if (!c) return null; } return c; };
const rid = (el, name = 'embed') => (el ? el.getAttributeNS(NS.r, name) || el.getAttribute('r:' + name) : null);

function resolvePath(base, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = base.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

// --- colour helpers ---------------------------------------------------------
function hexToRgb(h) { const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex([r, g, b]) { return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join(''); }
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const f = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
}

async function pptxToModel(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (p) => { const f = zip.file(p); return f ? f.async('string') : null; };
  const relsCache = {};
  async function relsOf(partPath) {
    if (relsCache[partPath]) return relsCache[partPath];
    const dir = partPath.split('/'); const file = dir.pop();
    const xml = await read(`${dir.join('/')}/_rels/${file}.rels`);
    const map = {};
    if (xml) for (const r of Array.from(parse(xml).getElementsByTagName('Relationship')))
      map[r.getAttribute('Id')] = { target: r.getAttribute('Target'), type: r.getAttribute('Type') || '', external: r.getAttribute('TargetMode') === 'External', path: resolvePath(partPath, r.getAttribute('Target')) };
    relsCache[partPath] = map;
    return map;
  }
  const relOfType = (rels, t) => Object.values(rels).find((r) => r.type.endsWith('/' + t));

  const presXml = await read('ppt/presentation.xml');
  if (!presXml) throw new Error('Не найден ppt/presentation.xml — файл повреждён или это не PPTX');
  const pres = parse(presXml);
  const sldSz = pres.getElementsByTagNameNS(NS.p, 'sldSz')[0];
  const width = sldSz ? +sldSz.getAttribute('cx') / EMU : 10;
  const height = sldSz ? +sldSz.getAttribute('cy') / EMU : 5.625;
  const presRels = await relsOf('ppt/presentation.xml');

  // theme colours
  const theme = {};
  const themeRel = relOfType(presRels, 'theme');
  const themeXml = await read(themeRel ? themeRel.path : 'ppt/theme/theme1.xml');
  let themeFonts = { major: 'Calibri', minor: 'Calibri' };
  if (themeXml) {
    const td = parse(themeXml);
    const scheme = td.getElementsByTagNameNS(NS.a, 'clrScheme')[0];
    for (const c of kids(scheme)) {
      const v = kid(c, 'srgbClr') || kid(c, 'sysClr');
      if (v) theme[c.localName] = '#' + (v.getAttribute('val') && v.localName === 'srgbClr' ? v.getAttribute('val') : v.getAttribute('lastClr') || '000000');
    }
    const maj = td.getElementsByTagNameNS(NS.a, 'majorFont')[0];
    const min = td.getElementsByTagNameNS(NS.a, 'minorFont')[0];
    if (maj) themeFonts.major = path(maj, 'latin')?.getAttribute('typeface') || 'Calibri';
    if (min) themeFonts.minor = path(min, 'latin')?.getAttribute('typeface') || 'Calibri';
  }
  const schemeMap = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };

  function colorOf(el) {
    // el is a fill container (solidFill etc) or colour element itself
    if (!el) return null;
    const c = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr'].includes(el.localName) ? el : kids(el).find((k) => /Clr$/.test(k.localName));
    if (!c) return null;
    let hex = null;
    if (c.localName === 'srgbClr') hex = '#' + c.getAttribute('val');
    else if (c.localName === 'sysClr') hex = '#' + (c.getAttribute('lastClr') || '000000');
    else if (c.localName === 'schemeClr') { const v = c.getAttribute('val'); hex = theme[schemeMap[v] || v] || (v === 'bg1' || v === 'lt1' ? '#ffffff' : '#000000'); }
    else if (c.localName === 'prstClr') hex = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080' }[c.getAttribute('val')] || '#000000';
    if (!hex || hex.length !== 7) return null;
    let rgb = hexToRgb(hex.slice(1));
    let hsl = rgbToHsl(rgb), touched = false;
    for (const m of kids(c)) {
      const v = +m.getAttribute('val') / 100000;
      if (m.localName === 'lumMod') { hsl[2] *= v; touched = true; }
      else if (m.localName === 'lumOff') { hsl[2] += v; touched = true; }
      else if (m.localName === 'tint') { rgb = hslToRgb(hsl).map((x) => x + (255 - x) * (1 - v)); hsl = rgbToHsl(rgb); touched = true; }
      else if (m.localName === 'shade') { rgb = hslToRgb(hsl).map((x) => x * v); hsl = rgbToHsl(rgb); touched = true; }
    }
    if (touched) { hsl[2] = Math.max(0, Math.min(1, hsl[2])); rgb = hslToRgb(hsl); }
    return rgbToHex(rgb);
  }

  const mediaCache = {};
  async function mediaData(partPath, rId) {
    const rels = await relsOf(partPath);
    const rel = rels[rId];
    if (!rel || rel.external) return null;
    if (mediaCache[rel.path]) return mediaCache[rel.path];
    const f = zip.file(rel.path);
    if (!f) return null;
    const ext = rel.path.split('.').pop().toLowerCase();
    if (!MIME[ext]) return null; // emf/wmf etc.
    const data = `data:${MIME[ext]};base64,${await f.async('base64')}`;
    mediaCache[rel.path] = data;
    return data;
  }

  // --- master / layout context ----------------------------------------------
  const partCache = {};
  async function loadPart(p) {
    if (partCache[p]) return partCache[p];
    const xml = await read(p);
    partCache[p] = xml ? parse(xml) : null;
    return partCache[p];
  }
  function phInfo(sp) {
    const nv = kid(sp, 'nvSpPr') || kid(sp, 'nvPicPr') || kid(sp, 'nvGraphicFramePr');
    const ph = path(nv, 'nvPr', 'ph');
    if (!ph) return null;
    return { type: ph.getAttribute('type') || 'body', idx: ph.getAttribute('idx') };
  }
  function findPh(docEl, info) {
    if (!docEl) return null;
    const tree = docEl.getElementsByTagNameNS(NS.p, 'spTree')[0];
    const sps = kids(tree, 'sp');
    const norm = (t) => (t === 'ctrTitle' ? 'title' : t === 'subTitle' ? 'body' : t === 'obj' ? 'body' : t);
    return (
      (info.idx != null && sps.find((s) => phInfo(s)?.idx === info.idx)) ||
      sps.find((s) => phInfo(s) && phInfo(s).type === info.type) ||
      sps.find((s) => phInfo(s) && norm(phInfo(s).type) === norm(info.type)) ||
      null
    );
  }
  function xfrmOf(sp) {
    const x = path(sp, 'spPr', 'xfrm') || path(sp, 'grpSpPr', 'xfrm') || kid(sp, 'xfrm');
    if (!x) return null;
    const off = kid(x, 'off'), ext = kid(x, 'ext');
    if (!off || !ext) return null;
    return {
      x: +off.getAttribute('x') / EMU, y: +off.getAttribute('y') / EMU,
      w: +ext.getAttribute('cx') / EMU, h: +ext.getAttribute('cy') / EMU,
      rot: (+x.getAttribute('rot') || 0) / 60000,
      flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1',
    };
  }
  function defSizeFromLst(lst, lvl = 1) {
    const l = kid(lst, `lvl${lvl}pPr`);
    const d = kid(l, 'defRPr');
    const sz = d && d.getAttribute('sz');
    return sz ? +sz / 100 : null;
  }
  function defColorFromLst(lst, lvl = 1) {
    const d = kid(kid(lst, `lvl${lvl}pPr`), 'defRPr');
    return d ? colorOf(kid(d, 'solidFill')) : null;
  }

  function backgroundOf(docEl) {
    const bg = docEl && docEl.getElementsByTagNameNS(NS.p, 'bg')[0];
    if (!bg) return null;
    const bgPr = kid(bg, 'bgPr');
    if (bgPr) {
      const sf = kid(bgPr, 'solidFill');
      if (sf) return { color: colorOf(sf) };
      const gf = kid(bgPr, 'gradFill');
      if (gf) { const gs = gf.getElementsByTagNameNS(NS.a, 'gs')[0]; if (gs) return { color: colorOf(gs) }; }
      const bf = kid(bgPr, 'blipFill');
      if (bf) return { blipRid: rid(kid(bf, 'blip')) };
    }
    const ref = kid(bg, 'bgRef');
    if (ref) return { color: colorOf(ref) };
    return null;
  }

  // --- shapes -----------------------------------------------------------------
  let idSeq = 1;
  const nid = () => 'e' + idSeq++;

  async function parseTextBody(txBody, ctx) {
    if (!txBody) return { paras: [], valign: 'top' };
    const bodyPr = kid(txBody, 'bodyPr');
    const anchor = bodyPr && bodyPr.getAttribute('anchor');
    const valign = anchor === 'ctr' ? 'middle' : anchor === 'b' ? 'bottom' : 'top';
    const fit = kid(bodyPr, 'normAutofit');
    const scale = fit && fit.getAttribute('fontScale') ? +fit.getAttribute('fontScale') / 100000 : 1;
    const lst = kid(txBody, 'lstStyle');
    const paras = [];
    for (const p of kids(txBody, 'p')) {
      const pPr = kid(p, 'pPr');
      const lvl = pPr && pPr.getAttribute('lvl') ? +pPr.getAttribute('lvl') : 0;
      const algn = (pPr && pPr.getAttribute('algn')) || ctx.align;
      const align = { ctr: 'center', r: 'right', just: 'justify', l: 'left' }[algn] || 'left';
      let bullet = ctx.bullet;
      if (pPr) {
        if (kid(pPr, 'buNone')) bullet = false;
        else if (kid(pPr, 'buAutoNum')) bullet = 'number';
        else if (kid(pPr, 'buChar')) bullet = true;
      }
      const defSize = defSizeFromLst(lst, lvl + 1) || (ctx.sizeAt && ctx.sizeAt(lvl + 1)) || ctx.size;
      const defColor = defColorFromLst(lst, lvl + 1) || ctx.color;
      const runs = [];
      const pushRun = (r, text) => {
        const rPr = kid(r, 'rPr');
        const run = { text };
        const sz = rPr && rPr.getAttribute('sz');
        run.size = Math.round(((sz ? +sz / 100 : defSize) || 18) * scale * 10) / 10;
        if (rPr && rPr.getAttribute('b') === '1') run.b = true;
        else if (ctx.bold && !(rPr && rPr.getAttribute('b') === '0')) run.b = true;
        if (rPr && rPr.getAttribute('i') === '1') run.i = true;
        if (rPr && rPr.getAttribute('u') && rPr.getAttribute('u') !== 'none') run.u = true;
        if (rPr && rPr.getAttribute('strike') && rPr.getAttribute('strike') !== 'noStrike') run.s = true;
        const col = rPr && colorOf(kid(rPr, 'solidFill'));
        run.color = col || defColor || '#000000';
        const latin = rPr && kid(rPr, 'latin');
        let face = latin && latin.getAttribute('typeface');
        if (face === '+mj-lt') face = themeFonts.major;
        if (face === '+mn-lt') face = themeFonts.minor;
        run.font = face || ctx.font;
        runs.push(run);
      };
      for (const c of kids(p)) {
        if (c.localName === 'r') pushRun(c, kid(c, 't')?.textContent || '');
        else if (c.localName === 'fld') pushRun(c, kid(c, 't')?.textContent || '');
        else if (c.localName === 'br') runs.push({ text: '\n', br: true });
      }
      if (!runs.length) {
        const end = kid(p, 'endParaRPr');
        const sz = end && end.getAttribute('sz');
        runs.push({ text: '', size: Math.round((sz ? +sz / 100 : defSize || 18) * scale * 10) / 10, color: defColor || '#000000', font: ctx.font });
      }
      paras.push({ runs, align, bullet: bullet || false, level: lvl });
    }
    // drop trailing empty paragraph that PowerPoint often adds
    return { paras, valign };
  }

  function geomOf(spPr) {
    const prst = path(spPr, 'prstGeom');
    const g = prst ? prst.getAttribute('prst') : kid(spPr, 'custGeom') ? 'rect' : 'rect';
    const map = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'rtTriangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon', octagon: 'octagon', rightArrow: 'rightArrow', leftArrow: 'leftArrow', upArrow: 'upArrow', downArrow: 'downArrow', star5: 'star5', line: 'line', straightConnector1: 'line', parallelogram: 'parallelogram', chevron: 'chevron', homePlate: 'homePlate', cloud: 'cloud', heart: 'heart' };
    return map[g] || 'rect';
  }

  function fillOf(spPr, styleEl) {
    if (!spPr) return null;
    if (kid(spPr, 'noFill')) return null;
    const sf = kid(spPr, 'solidFill');
    if (sf) {
      const clr = kids(sf).find((k) => /Clr$/.test(k.localName));
      const alpha = clr && kid(clr, 'alpha');
      if (alpha && +alpha.getAttribute('val') === 0) return null; // fully transparent
      return colorOf(sf);
    }
    const gf = kid(spPr, 'gradFill');
    if (gf) { const gs = gf.getElementsByTagNameNS(NS.a, 'gs')[0]; return gs ? colorOf(gs) : null; }
    if (styleEl) { const fr = path(styleEl, 'fillRef'); if (fr && fr.getAttribute('idx') !== '0') return colorOf(fr); }
    return null;
  }
  function lineOf(spPr, styleEl) {
    const ln = kid(spPr, 'ln');
    if (ln && kid(ln, 'noFill')) return null;
    let color = ln ? colorOf(kid(ln, 'solidFill')) : null;
    const w = ln && ln.getAttribute('w') ? +ln.getAttribute('w') / 12700 : 1;
    if (!color && styleEl) { const lr = path(styleEl, 'lnRef'); if (lr && lr.getAttribute('idx') !== '0') color = colorOf(lr); }
    return color ? { color, width: Math.round(w * 4) / 4 } : null;
  }

  async function shapesFrom(tree, part, ctx) {
    const out = [];
    for (const el of kids(tree)) {
      const ln = el.localName;
      if (ln === 'sp' || ln === 'cxnSp') {
        const info = phInfo(el);
        if (ctx.skipPlaceholders && info) continue;
        let xf = xfrmOf(el);
        let layoutSp = null, masterSp = null;
        if (info) {
          layoutSp = findPh(ctx.layoutDoc, info);
          masterSp = findPh(ctx.masterDoc, info);
          xf = xf || xfrmOf(layoutSp) || xfrmOf(masterSp);
        }
        if (!xf) continue;
        if (ctx.group) xf = ctx.group(xf);
        const spPr = kid(el, 'spPr');
        const styleEl = kid(el, 'style');
        const isTitle = info && (info.type === 'title' || info.type === 'ctrTitle');
        const isBody = info && ['body', 'obj', 'subTitle'].includes(info.type) && info.type !== 'subTitle';
        const txStyle = isTitle ? ctx.titleStyle : info ? ctx.bodyStyle : ctx.otherStyle;
        const lstLayout = path(layoutSp, 'txBody', 'lstStyle');
        const lstMaster = path(masterSp, 'txBody', 'lstStyle');
        const fontRef = styleEl && path(styleEl, 'fontRef');
        const tctx = {
          size: defSizeFromLst(lstLayout) || defSizeFromLst(lstMaster) || defSizeFromLst(txStyle) || 18,
          color: defColorFromLst(lstLayout) || defColorFromLst(lstMaster) || (fontRef && colorOf(fontRef)) || defColorFromLst(txStyle) || theme.dk1 || '#000000',
          font: isTitle ? themeFonts.major : themeFonts.minor,
          bullet: !!isBody && ctx.bodyStyle && !kid(kid(ctx.bodyStyle, 'lvl1pPr'), 'buNone'),
          align: (kid(lstLayout, 'lvl1pPr') || kid(lstMaster, 'lvl1pPr') || kid(txStyle, 'lvl1pPr'))?.getAttribute('algn') || null,
          bold: false,
          sizeAt: (l) => defSizeFromLst(lstLayout, l) || defSizeFromLst(lstMaster, l) || defSizeFromLst(txStyle, l),
        };
        const bodyPr = path(el, 'txBody', 'bodyPr');
        const lAnchor = path(layoutSp, 'txBody', 'bodyPr')?.getAttribute('anchor') || path(masterSp, 'txBody', 'bodyPr')?.getAttribute('anchor');
        const { paras, valign } = await parseTextBody(kid(el, 'txBody'), tctx);
        let va = valign;
        if (!(bodyPr && bodyPr.getAttribute('anchor')) && lAnchor) va = lAnchor === 'ctr' ? 'middle' : lAnchor === 'b' ? 'bottom' : 'top';
        const hasText = paras.some((p) => p.runs.some((r) => r.text.trim()));
        const geom = ln === 'cxnSp' ? 'line' : geomOf(spPr);
        const fill = fillOf(spPr, styleEl);
        const line = lineOf(spPr, styleEl);
        const cust = kid(spPr, 'custGeom');
        if (cust && !fill && line && !hasText) {
          // freehand / custom outline without fill -> editable ink stroke
          const paths = [];
          for (const pth of Array.from(cust.getElementsByTagNameNS(NS.a, 'path'))) {
            const pw = +pth.getAttribute('w') || 0, phh = +pth.getAttribute('h') || 0;
            const fx = pw ? xf.w / pw : 1 / EMU, fy = phh ? xf.h / phh : 1 / EMU;
            let cur = null;
            for (const cmd of kids(pth)) {
              const pts = Array.from(cmd.getElementsByTagNameNS(NS.a, 'pt'));
              const last = pts[pts.length - 1];
              if (!last) continue;
              const pt = [+last.getAttribute('x') * fx, +last.getAttribute('y') * fy];
              if (cmd.localName === 'moveTo' || !cur) { cur = [pt]; paths.push(cur); } else cur.push(pt);
            }
          }
          if (paths.length) {
            out.push({ id: nid(), type: 'ink', x: xf.x, y: xf.y, w: xf.w || 0.02, h: xf.h || 0.02, rot: xf.rot, vw: xf.w || 0.02, vh: xf.h || 0.02, color: line.color, width: line.width || 3, paths });
            continue;
          }
        }
        if (!hasText && !fill && !line && info) continue; // empty placeholder ("Click to add title")
        if (!hasText && !fill && !line && geom !== 'line') continue;
        out.push({
          id: nid(), type: 'box', geom, x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot, flipH: xf.flipH, flipV: xf.flipV,
          fill, line: line || (geom === 'line' ? { color: '#000000', width: 1 } : null),
          paras: hasText ? paras : [], valign: va,
        });
      } else if (ln === 'pic') {
        if (ctx.skipPlaceholders && phInfo(el)) continue;
        let xf = xfrmOf(el);
        if (!xf) continue;
        if (ctx.group) xf = ctx.group(xf);
        const data = await mediaData(part, rid(path(el, 'blipFill', 'blip')));
        if (data) out.push({ id: nid(), type: 'image', data, x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: xf.rot });
      } else if (ln === 'grpSp') {
        const gx = path(el, 'grpSpPr', 'xfrm');
        if (!gx) continue;
        const g = (n) => { const o = kid(gx, n); return o ? [+(o.getAttribute('x') ?? o.getAttribute('cx')) / EMU, +(o.getAttribute('y') ?? o.getAttribute('cy')) / EMU] : [0, 0]; };
        const [ox, oy] = g('off'), [ew, eh] = g('ext'), [cx, cy] = g('chOff'), [cw, ch] = g('chExt');
        const sx = cw ? ew / cw : 1, sy = ch ? eh / ch : 1;
        const outer = ctx.group;
        const group = (xf) => {
          const r = { ...xf, x: ox + (xf.x - cx) * sx, y: oy + (xf.y - cy) * sy, w: xf.w * sx, h: xf.h * sy };
          return outer ? outer(r) : r;
        };
        out.push(...(await shapesFrom(el, part, { ...ctx, group })));
      } else if (ln === 'graphicFrame') {
        const xfe = kid(el, 'xfrm');
        if (!xfe) continue;
        let xf = { x: +kid(xfe, 'off').getAttribute('x') / EMU, y: +kid(xfe, 'off').getAttribute('y') / EMU, w: +kid(xfe, 'ext').getAttribute('cx') / EMU, h: +kid(xfe, 'ext').getAttribute('cy') / EMU, rot: 0 };
        if (ctx.group) xf = ctx.group(xf);
        const tbl = el.getElementsByTagNameNS(NS.a, 'tbl')[0];
        if (tbl) {
          const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((c) => +c.getAttribute('w') / EMU);
          const rows = [];
          for (const tr of kids(tbl, 'tr')) {
            const row = [];
            for (const tc of kids(tr, 'tc')) {
              const { paras } = await parseTextBody(kid(tc, 'txBody'), { size: 14, color: theme.dk1 || '#000000', font: themeFonts.minor });
              const text = paras.map((p) => p.runs.map((r) => r.text).join('')).join('\n');
              const fill = colorOf(path(tc, 'tcPr', 'solidFill'));
              const first = paras[0]?.runs[0] || {};
              row.push({ text, fill: fill || null, b: !!first.b, size: first.size || 14, color: first.color || '#000000' });
            }
            rows.push(row);
          }
          out.push({ id: nid(), type: 'table', x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: 0, cols, rows });
        } else {
          out.push({ id: nid(), type: 'box', geom: 'rect', x: xf.x, y: xf.y, w: xf.w, h: xf.h, rot: 0, fill: '#f3f4f6', line: { color: '#9ca3af', width: 1 }, valign: 'middle',
            paras: [{ runs: [{ text: '[Диаграмма или объект — не поддерживается для редактирования]', size: 12, color: '#6b7280', font: themeFonts.minor }], align: 'center', bullet: false, level: 0 }] });
        }
      }
    }
    return out;
  }

  // --- slides -------------------------------------------------------------------
  const slideIds = Array.from(pres.getElementsByTagNameNS(NS.p, 'sldId'));
  const slides = [];
  for (const s of slideIds) {
    const rel = presRels[rid(s, 'id')];
    if (!rel) continue;
    const slidePath = rel.path;
    const slideDoc = await loadPart(slidePath);
    if (!slideDoc) continue;
    const sRels = await relsOf(slidePath);
    const layoutRel = relOfType(sRels, 'slideLayout');
    const layoutPath = layoutRel && layoutRel.path;
    const layoutDoc = layoutPath ? await loadPart(layoutPath) : null;
    const lRels = layoutPath ? await relsOf(layoutPath) : {};
    const masterRel = relOfType(lRels, 'slideMaster');
    const masterPath = masterRel && masterRel.path;
    const masterDoc = masterPath ? await loadPart(masterPath) : null;
    const txStyles = masterDoc && masterDoc.getElementsByTagNameNS(NS.p, 'txStyles')[0];
    const base = {
      layoutDoc, masterDoc,
      titleStyle: kid(txStyles, 'titleStyle'), bodyStyle: kid(txStyles, 'bodyStyle'), otherStyle: kid(txStyles, 'otherStyle'),
    };

    // background: slide -> layout -> master
    let bg = null, bgPart = null;
    for (const [d, pth] of [[slideDoc, slidePath], [layoutDoc, layoutPath], [masterDoc, masterPath]]) {
      const b = backgroundOf(d);
      if (b) { bg = b; bgPart = pth; break; }
    }
    let background = '#ffffff', backgroundImage = null;
    if (bg && bg.color) background = bg.color;
    if (bg && bg.blipRid) backgroundImage = await mediaData(bgPart, bg.blipRid);

    const elements = [];
    const showMaster = (d) => !d || d.documentElement.getAttribute('showMasterSp') !== '0';
    if (showMaster(slideDoc)) {
      if (masterDoc && showMaster(layoutDoc)) {
        const mt = masterDoc.getElementsByTagNameNS(NS.p, 'spTree')[0];
        elements.push(...(await shapesFrom(mt, masterPath, { ...base, skipPlaceholders: true })));
      }
      if (layoutDoc) {
        const lt = layoutDoc.getElementsByTagNameNS(NS.p, 'spTree')[0];
        elements.push(...(await shapesFrom(lt, layoutPath, { ...base, skipPlaceholders: true })));
      }
    }
    const tree = slideDoc.getElementsByTagNameNS(NS.p, 'spTree')[0];
    elements.push(...(await shapesFrom(tree, slidePath, base)));

    // speaker notes
    let notes = '';
    const notesRel = relOfType(sRels, 'notesSlide');
    if (notesRel) {
      const nd = await loadPart(notesRel.path);
      if (nd) {
        for (const sp of Array.from(nd.getElementsByTagNameNS(NS.p, 'sp'))) {
          const info = phInfo(sp);
          if (info && info.type === 'body') {
            notes = Array.from(sp.getElementsByTagNameNS(NS.a, 'p')).map((p) => Array.from(p.getElementsByTagNameNS(NS.a, 't')).map((t) => t.textContent).join('')).join('\n').trim();
          }
        }
      }
    }
    slides.push({ id: 's' + slides.length + '_' + Date.now().toString(36), background, backgroundImage, elements, notes });
  }
  if (!slides.length) slides.push({ id: 's0', background: '#ffffff', backgroundImage: null, elements: [], notes: '' });
  return { width, height, slides };
}

module.exports = { pptxToModel };
