/* Equations: Word OMML <-> MathML, LaTeX -> MathML, MathML -> LaTeX.
 * Works in the renderer (window.OSMath) and in Node (require), on any DOM-like tree
 * (browser DOM or @xmldom/xmldom). */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.OSMath = m;
})(typeof self !== 'undefined' ? self : this, function () {
  const NS_M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
  const NS_W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const NS_MML = 'http://www.w3.org/1998/Math/MathML';

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const els = (n) => { const out = []; for (let c = n && n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) out.push(c); return out; };
  const ln = (n) => n.localName || String(n.nodeName).replace(/^.*:/, '');
  const child = (n, name) => els(n).find((c) => ln(c) === name) || null;
  const val = (n) => {
    if (!n) return null;
    return n.getAttributeNS && (n.getAttributeNS(NS_M, 'val') || n.getAttributeNS(NS_W, 'val')) || n.getAttribute('m:val') || n.getAttribute('w:val') || n.getAttribute('val');
  };
  const prop = (n, prName, name) => { const pr = child(n, prName); const p = pr && child(pr, name); return p ? val(p) : undefined; };
  const has = (n, prName, name) => { const pr = child(n, prName); return !!(pr && child(pr, name)); };
  const onOff = (v) => v === undefined ? false : !(v === '0' || v === 'off' || v === 'false');

  // ---------------------------------------------------------------- OMML -> MathML
  const OPS = new Set('+-−±∓×÷·∙∘*/=≠≈≡≤≥<>≪≫∝∼≃≅∈∉⊂⊃⊆⊇∪∩∧∨¬→←↔⇒⇐⇔↦∀∃∂∇∞%!,;:|‖()[]{}⟨⟩⌊⌋⌈⌉…⋯′″'.split(''));
  const FUNCS = new Set(['sin', 'cos', 'tan', 'tg', 'cot', 'ctg', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'arctg', 'arcctg', 'sinh', 'cosh', 'tanh', 'sh', 'ch', 'th', 'cth', 'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'mod', 'Re', 'Im']);

  /** text of a math run split into mi / mn / mo tokens */
  function tokens(text, plain, bold) {
    let out = '';
    const variant = plain ? (bold ? ' mathvariant="bold"' : ' mathvariant="normal"') : bold ? ' mathvariant="bold-italic"' : '';
    const re = /(\d+(?:[.,]\d+)*)|([A-Za-z]+)|(\s+)|(.)/gsu;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) out += `<mn>${esc(m[1])}</mn>`;
      else if (m[2]) {
        if (plain || FUNCS.has(m[2])) out += `<mi${m[2].length > 1 || plain ? (bold ? ' mathvariant="bold"' : ' mathvariant="normal"') : variant}>${esc(m[2])}</mi>`;
        else for (const ch of m[2]) out += `<mi${variant}>${esc(ch)}</mi>`;
      } else if (m[3]) out += `<mspace width="${0.28 * m[3].length}em"/>`;
      else {
        const ch = m[4];
        if (OPS.has(ch) || /[←-⋿⨀-⫿]/.test(ch)) out += `<mo>${esc(ch === '-' ? '−' : ch)}</mo>`;
        else out += `<mi${variant}>${esc(ch)}</mi>`;
      }
    }
    return out;
  }
  const mrow = (s) => `<mrow>${s}</mrow>`;
  const ACC = { '̂': '^', '̃': '~', '̇': '˙', '̈': '¨', '⃗': '→', '̅': '¯', '̄': '¯', '́': '´', '̀': '`', '̌': 'ˇ', '̆': '˘', '⃖': '←', '⃡': '↔' };

  function conv(n) {
    if (!n || n.nodeType !== 1) return '';
    const name = ln(n);
    const kidsOf = (c) => (c ? els(c).map(conv).join('') : '');
    const arg = (k) => mrow(kidsOf(child(n, k)));
    switch (name) {
      case 'oMathPara': return els(n).filter((c) => ln(c) === 'oMath').map(conv).join('<mspace linebreak="newline"/>');
      case 'oMath': case 'e': case 'num': case 'den': case 'sub': case 'sup': case 'deg': case 'lim': case 'fName':
        return kidsOf(n);
      case 'r': {
        let text = '';
        for (const c of els(n)) if (ln(c) === 't') text += c.textContent;
        const sty = prop(n, 'rPr', 'sty');
        const nor = has(n, 'rPr', 'nor');
        if (nor) return `<mtext>${esc(text)}</mtext>`;
        return tokens(text, sty === 'p' || sty === 'b', sty === 'b' || sty === 'bi');
      }
      case 'f': {
        const type = prop(n, 'fPr', 'type');
        if (type === 'lin') return mrow(`${arg('num')}<mo>/</mo>${arg('den')}`);
        if (type === 'skw') return `<mfrac bevelled="true">${arg('num')}${arg('den')}</mfrac>`;
        return `<mfrac${type === 'noBar' ? ' linethickness="0"' : ''}>${arg('num')}${arg('den')}</mfrac>`;
      }
      case 'sSup': return `<msup>${arg('e')}${arg('sup')}</msup>`;
      case 'sSub': return `<msub>${arg('e')}${arg('sub')}</msub>`;
      case 'sSubSup': return `<msubsup>${arg('e')}${arg('sub')}${arg('sup')}</msubsup>`;
      case 'sPre': return `<mmultiscripts>${arg('e')}<mprescripts/>${arg('sub')}${arg('sup')}</mmultiscripts>`;
      case 'rad': {
        const hide = onOff(prop(n, 'radPr', 'degHide'));
        const deg = child(n, 'deg');
        if (hide || !deg || !els(deg).length) return `<msqrt>${kidsOf(child(n, 'e'))}</msqrt>`;
        return `<mroot>${arg('e')}${arg('deg')}</mroot>`;
      }
      case 'nary': {
        const chr = prop(n, 'naryPr', 'chr') || '∫';
        const loc = prop(n, 'naryPr', 'limLoc') || (chr === '∫' || chr === '∬' || chr === '∭' || chr === '∮' ? 'subSup' : 'undOvr');
        const subHide = onOff(prop(n, 'naryPr', 'subHide')), supHide = onOff(prop(n, 'naryPr', 'supHide'));
        const op = `<mo largeop="true" movablelimits="false">${esc(chr)}</mo>`;
        let head;
        const sub = arg('sub'), sup = arg('sup');
        if (subHide && supHide) head = op;
        else if (loc === 'undOvr') head = subHide ? `<mover>${op}${sup}</mover>` : supHide ? `<munder>${op}${sub}</munder>` : `<munderover>${op}${sub}${sup}</munderover>`;
        else head = subHide ? `<msup>${op}${sup}</msup>` : supHide ? `<msub>${op}${sub}</msub>` : `<msubsup>${op}${sub}${sup}</msubsup>`;
        return mrow(head + arg('e'));
      }
      case 'd': {
        const pr = child(n, 'dPr');
        const get = (k, d) => { const c = pr && child(pr, k); if (!c) return d; const v = val(c); return v == null ? d : v; };
        const beg = get('begChr', '('), end = get('endChr', ')'), sep = get('sepChr', '|');
        const parts = els(n).filter((c) => ln(c) === 'e').map((c) => mrow(kidsOf(c)));
        return mrow(`${beg ? `<mo fence="true">${esc(beg)}</mo>` : ''}${parts.join(`<mo separator="true">${esc(sep)}</mo>`)}${end ? `<mo fence="true">${esc(end)}</mo>` : ''}`);
      }
      case 'func': return mrow(`${mrow(kidsOf(child(n, 'fName')))}<mo>&#x2061;</mo>${arg('e')}`);
      case 'acc': {
        const chr = prop(n, 'accPr', 'chr') || '̂';
        return `<mover accent="true">${arg('e')}<mo>${esc(ACC[chr] || chr)}</mo></mover>`;
      }
      case 'bar': {
        const pos = prop(n, 'barPr', 'pos') || 'bot';
        return pos === 'top' ? `<mover accent="true">${arg('e')}<mo>¯</mo></mover>` : `<munder accentunder="true">${arg('e')}<mo>_</mo></munder>`;
      }
      case 'groupChr': {
        const chr = prop(n, 'groupChrPr', 'chr') || '⏟';
        const pos = prop(n, 'groupChrPr', 'pos') || 'bot';
        return pos === 'top' ? `<mover>${arg('e')}<mo>${esc(chr)}</mo></mover>` : `<munder>${arg('e')}<mo>${esc(chr)}</mo></munder>`;
      }
      case 'limLow': return `<munder>${arg('e')}${arg('lim')}</munder>`;
      case 'limUpp': return `<mover>${arg('e')}${arg('lim')}</mover>`;
      case 'm': {
        const rows = els(n).filter((c) => ln(c) === 'mr');
        return `<mtable>${rows.map((r) => `<mtr>${els(r).filter((c) => ln(c) === 'e').map((c) => `<mtd>${mrow(kidsOf(c))}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
      }
      case 'eqArr': return `<mtable columnalign="left">${els(n).filter((c) => ln(c) === 'e').map((c) => `<mtr><mtd>${mrow(kidsOf(c))}</mtd></mtr>`).join('')}</mtable>`;
      case 'borderBox': return `<menclose notation="box">${arg('e')}</menclose>`;
      case 'box': case 'phant': return arg('e');
      case 'ctrlPr': case 'rPr': case 'fPr': case 'naryPr': case 'dPr': case 'radPr': case 'accPr': case 'barPr': case 'funcPr': case 'sSupPr': case 'sSubPr': case 'sSubSupPr': case 'mPr': case 'eqArrPr': case 'limLowPr': case 'limUppPr': case 'groupChrPr': case 'boxPr': case 'borderBoxPr': case 'phantPr': case 'sPrePr': case 'oMathParaPr':
        return '';
      case 't': return tokens(n.textContent);
      default:
        // w:r inside a formula, unknown elements: keep their text
        return kidsOf(n) || (n.textContent ? tokens(n.textContent) : '');
    }
  }
  /** OMML element (m:oMath or m:oMathPara) -> <math> string */
  function ommlToMathml(node) {
    const display = ln(node) === 'oMathPara';
    return `<math xmlns="${NS_MML}"${display ? ' display="block"' : ''}>${mrow(conv(node))}</math>`;
  }

  // ---------------------------------------------------------------- LaTeX -> MathML
  const GREEK = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω' };
  const SYMS = { cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', leftrightarrow: '↔', mapsto: '↦', in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', cup: '∪', cap: '∩', wedge: '∧', vee: '∨', neg: '¬', forall: '∀', exists: '∃', partial: '∂', nabla: '∇', angle: '∠', perp: '⊥', parallel: '∥', degree: '°', circ: '∘', ldots: '…', cdots: '⋯', dots: '…', prime: '′', ll: '≪', gg: '≫', emptyset: '∅', varnothing: '∅', triangle: '△', star: '⋆', ast: '∗', langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', backslash: '\\', '%': '%', '{': '{', '}': '}', '#': '#', '&': '&', '_': '_', ',': ' ', ';': ' ', ':': ' ', quad: ' ', qquad: '  ', '!': '' };
  const BIGOPS = { sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮', bigcup: '⋃', bigcap: '⋂' };
  const ACCENTS = { hat: '^', widehat: '^', tilde: '~', widetilde: '~', bar: '¯', overline: '¯', vec: '→', dot: '˙', ddot: '¨', check: 'ˇ', breve: '˘', acute: '´', grave: '`', overrightarrow: '→' };

  function latexToMathml(src, display) {
    let i = 0;
    const s = String(src || '');
    const peek = () => s[i];
    const skipWs = () => { while (i < s.length && /\s/.test(s[i])) i++; };
    function cmdName() {
      i++; // backslash
      if (i < s.length && !/[A-Za-z]/.test(s[i])) return s[i++];
      let n = '';
      while (i < s.length && /[A-Za-z]/.test(s[i])) n += s[i++];
      return n;
    }
    function group() {
      skipWs();
      if (peek() === '{') { i++; const r = seq('}'); i++; return mrow(r); }
      return atom() || '<mrow/>';
    }
    function optArg() {
      skipWs();
      if (peek() !== '[') return null;
      i++; const r = seq(']'); i++; return mrow(r);
    }
    function textArg() {
      skipWs();
      if (peek() !== '{') return '';
      let depth = 0, t = '';
      i++;
      while (i < s.length && !(s[i] === '}' && depth === 0)) { if (s[i] === '{') depth++; if (s[i] === '}') depth--; t += s[i++]; }
      i++;
      return t;
    }
    function delim() {
      skipWs();
      if (s[i] === '\\') { const save = i; const n = cmdName(); if (n === '{' || n === '}') return n; if (n === '|') return '‖'; if (SYMS[n] !== undefined) return SYMS[n]; i = save; return ''; }
      const c = s[i++];
      return c === '.' ? '' : c;
    }
    function env(name) {
      // matrices and cases: rows split by \\, cells by &
      const rows = [[]];
      let cell = '';
      const flush = () => { rows[rows.length - 1].push(mrow(cell)); cell = ''; };
      while (i < s.length) {
        skipWs();
        if (s.startsWith('\\end', i)) { i += 4; textArg(); break; }
        if (s[i] === '&') { i++; flush(); continue; }
        if (s.startsWith('\\\\', i)) { i += 2; flush(); rows.push([]); continue; }
        cell += atomWithScripts();
      }
      flush();
      const body = `<mtable${name === 'cases' ? ' columnalign="left left"' : ''}>${rows.filter((r) => r.some((c) => c !== '<mrow></mrow>')).map((r) => `<mtr>${r.map((c) => `<mtd>${c}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
      const br = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''] }[name];
      return br ? mrow(`<mo fence="true">${esc(br[0])}</mo>${body}${br[1] ? `<mo fence="true">${esc(br[1])}</mo>` : ''}`) : body;
    }
    function atom() {
      skipWs();
      const c = peek();
      if (c === undefined) return '';
      if (c === '{') return group();
      if (c === '\\') {
        const n = cmdName();
        if (n === 'frac' || n === 'dfrac' || n === 'tfrac') { const a = group(), b = group(); return `<mfrac>${a}${b}</mfrac>`; }
        if (n === 'binom') { const a = group(), b = group(); return mrow(`<mo fence="true">(</mo><mfrac linethickness="0">${a}${b}</mfrac><mo fence="true">)</mo>`); }
        if (n === 'sqrt') { const d = optArg(); const a = group(); return d ? `<mroot>${a}${d}</mroot>` : `<msqrt>${a}</msqrt>`; }
        if (n === 'left') { const l = delim(); const inner = seq('\\right'); i += 6; const r = delim(); return mrow(`${l ? `<mo fence="true">${esc(l)}</mo>` : ''}${inner}${r ? `<mo fence="true">${esc(r)}</mo>` : ''}`); }
        if (n === 'right') return '';
        if (n === 'text' || n === 'textrm' || n === 'mbox' || n === 'operatorname') { const t = textArg(); return n === 'operatorname' ? `<mi mathvariant="normal">${esc(t)}</mi>` : `<mtext>${esc(t)}</mtext>`; }
        if (n === 'mathrm' || n === 'mathbf' || n === 'mathit' || n === 'mathbb' || n === 'mathcal') {
          const t = textArg();
          const v = { mathrm: 'normal', mathbf: 'bold', mathit: 'italic', mathbb: 'double-struck', mathcal: 'script' }[n];
          return mrow(Array.from(t).map((ch) => (/\d/.test(ch) ? `<mn${n === 'mathbf' ? ' mathvariant="bold"' : ''}>${ch}</mn>` : `<mi mathvariant="${v}">${esc(ch)}</mi>`)).join(''));
        }
        if (ACCENTS[n]) { const a = group(); return `<mover accent="true">${a}<mo>${ACCENTS[n]}</mo></mover>`; }
        if (n === 'underline') { const a = group(); return `<munder accentunder="true">${a}<mo>_</mo></munder>`; }
        if (n === 'overbrace' || n === 'underbrace') { const a = group(); return n === 'overbrace' ? `<mover>${a}<mo>⏞</mo></mover>` : `<munder>${a}<mo>⏟</mo></munder>`; }
        if (n === 'begin') { const e = textArg(); return env(e); }
        if (BIGOPS[n]) return `<mo largeop="true" movablelimits="false">${BIGOPS[n]}</mo>`;
        if (n === 'lim' || n === 'max' || n === 'min' || n === 'sup' || n === 'inf') return `<mi mathvariant="normal" data-limits="1">${n}</mi>`;
        if (FUNCS.has(n)) return `<mi mathvariant="normal">${n}</mi>`;
        if (GREEK[n]) return /^[A-Z]/.test(n) ? `<mi mathvariant="normal">${GREEK[n]}</mi>` : `<mi>${GREEK[n]}</mi>`;
        if (SYMS[n] !== undefined) {
          const v = SYMS[n];
          if (n === ',' || n === ';' || n === ':' || n === 'quad' || n === 'qquad') return `<mspace width="${{ ',': 0.17, ';': 0.28, ':': 0.22, quad: 1, qquad: 2 }[n]}em"/>`;
          if (n === '!') return '';
          return /[α-ωΑ-Ω∞∂∇∅]/.test(v) ? `<mi>${esc(v)}</mi>` : `<mo>${esc(v)}</mo>`;
        }
        return `<mi mathvariant="normal">${esc(n)}</mi>`;
      }
      i++;
      if (/\d/.test(c)) { let n = c; while (i < s.length && /[\d.,]/.test(s[i]) && !(s[i] === ',' && !/\d/.test(s[i + 1] || ''))) n += s[i++]; return `<mn>${esc(n)}</mn>`; }
      if (/[A-Za-zЀ-ӿ]/.test(c)) return `<mi>${esc(c)}</mi>`;
      if (c === '\'') return '<mo>′</mo>';
      if (c === '-') return '<mo>−</mo>';
      if (c === '~') return '<mspace width="0.28em"/>';
      return `<mo>${esc(c)}</mo>`;
    }
    function atomWithScripts() {
      let base = atom();
      for (;;) {
        skipWs();
        const c = peek();
        if (c !== '^' && c !== '_') break;
        i++;
        const first = group();
        skipWs();
        let sub = null, sup = null;
        if (c === '^') sup = first; else sub = first;
        if ((peek() === '^' && !sup) || (peek() === '_' && !sub)) { const k = s[i++]; const g = group(); if (k === '^') sup = g; else sub = g; }
        const limits = /largeop="true"/.test(base) && /[∑∏∐⋃⋂]/.test(base) || /data-limits/.test(base);
        if (sub && sup) base = limits ? `<munderover>${base}${sub}${sup}</munderover>` : `<msubsup>${base}${sub}${sup}</msubsup>`;
        else if (sub) base = limits ? `<munder>${base}${sub}</munder>` : `<msub>${base}${sub}</msub>`;
        else base = limits ? `<mover>${base}${sup}</mover>` : `<msup>${base}${sup}</msup>`;
      }
      return base;
    }
    function seq(stop) {
      let out = '';
      while (i < s.length) {
        skipWs();
        if (i >= s.length) break;
        if (stop && s.startsWith(stop, i)) break;
        if (!stop && s[i] === '}') { i++; continue; } // stray closing brace
        out += atomWithScripts();
      }
      return out;
    }
    const body = seq(null).replace(/ data-limits="1"/g, '');
    return `<math xmlns="${NS_MML}"${display ? ' display="block"' : ''}>${mrow(body)}</math>`;
  }

  // ---------------------------------------------------------------- MathML -> OMML
  const mr = (text, plain) => `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
  function toOmml(n) {
    if (!n) return '';
    if (n.nodeType === 3) return n.nodeValue.trim() ? mr(n.nodeValue) : '';
    if (n.nodeType !== 1) return '';
    const name = ln(n);
    const k = els(n);
    const e = (x) => `<m:e>${toOmml(x)}</m:e>`;
    const inner = (x) => toOmml(x);
    switch (name) {
      case 'math': case 'mrow': case 'mstyle': case 'semantics': case 'mpadded': case 'mphantom': {
        // fenced group -> m:d
        if (k.length >= 2 && ln(k[0]) === 'mo' && k[0].getAttribute('fence') === 'true' && ln(k[k.length - 1]) === 'mo' && k[k.length - 1].getAttribute('fence') === 'true') {
          const beg = k[0].textContent, end = k[k.length - 1].textContent;
          return `<m:d><m:dPr><m:begChr m:val="${esc(beg)}"/><m:endChr m:val="${esc(end)}"/></m:dPr><m:e>${k.slice(1, -1).map(toOmml).join('')}</m:e></m:d>`;
        }
        if (k.length >= 2 && ln(k[0]) === 'mo' && k[0].getAttribute('fence') === 'true') {
          return `<m:d><m:dPr><m:begChr m:val="${esc(k[0].textContent)}"/><m:endChr m:val=""/></m:dPr><m:e>${k.slice(1).map(toOmml).join('')}</m:e></m:d>`;
        }
        // big operator followed by its operand -> m:nary
        let out = '';
        for (let j = 0; j < k.length; j++) {
          const x = k[j];
          const op = naryOf(x);
          if (op) {
            // the operand runs up to the next relation sign (=, <, ≤, …) or comma, like in Word
            let end = j + 1;
            while (end < k.length && !(ln(k[end]) === 'mo' && /^[=<>≤≥≠≈≡∼≃≅→⇒⇔,;]$/.test(k[end].textContent.trim()))) end++;
            const rest = k.slice(j + 1, end);
            out += `<m:nary><m:naryPr><m:chr m:val="${esc(op.chr)}"/><m:limLoc m:val="${op.loc}"/>${op.sub ? '' : '<m:subHide m:val="1"/>'}${op.sup ? '' : '<m:supHide m:val="1"/>'}</m:naryPr><m:sub>${op.sub ? inner(op.sub) : ''}</m:sub><m:sup>${op.sup ? inner(op.sup) : ''}</m:sup><m:e>${rest.map(toOmml).join('')}</m:e></m:nary>`;
            j = end - 1;
            continue;
          }
          // function name followed by its argument -> m:func
          if ((ln(x) === 'mi' && x.textContent.length > 1 && FUNCS.has(x.textContent)) || (/^m(under|sub)$/.test(ln(x)) && els(x)[0] && FUNCS.has(els(x)[0].textContent))) {
            const nx = k[j + 1] && ln(k[j + 1]) === 'mo' && k[j + 1].textContent === '⁡' ? j + 2 : j + 1;
            if (k[nx]) {
              const fname = ln(x) === 'munder' ? `<m:limLow><m:e>${mr(els(x)[0].textContent, true)}</m:e><m:lim>${inner(els(x)[1])}</m:lim></m:limLow>` : ln(x) === 'msub' ? `<m:sSub><m:e>${mr(els(x)[0].textContent, true)}</m:e><m:sub>${inner(els(x)[1])}</m:sub></m:sSub>` : mr(x.textContent, true);
              out += `<m:func><m:fName>${fname}</m:fName><m:e>${toOmml(k[nx])}</m:e></m:func>`;
              j = nx;
              continue;
            }
          }
          out += toOmml(x);
        }
        return out;
      }
      case 'mi': {
        const t = x0(n);
        const plain = n.getAttribute('mathvariant') === 'normal' || t.length > 1;
        return mr(t, plain);
      }
      case 'mn': return mr(x0(n));
      case 'mo': { const t = x0(n); return t === '⁡' ? '' : mr(t); }
      case 'mtext': return `<m:r><m:rPr><m:nor/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">${esc(n.textContent)}</m:t></m:r>`;
      case 'mspace': return mr(' ');
      case 'mfrac': {
        const noBar = n.getAttribute('linethickness') === '0';
        return `<m:f>${noBar ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}<m:num>${inner(k[0])}</m:num><m:den>${inner(k[1])}</m:den></m:f>`;
      }
      case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${k.map(toOmml).join('')}</m:e></m:rad>`;
      case 'mroot': return `<m:rad><m:deg>${inner(k[1])}</m:deg>${e(k[0])}</m:rad>`;
      case 'msup': return `<m:sSup>${e(k[0])}<m:sup>${inner(k[1])}</m:sup></m:sSup>`;
      case 'msub': return `<m:sSub>${e(k[0])}<m:sub>${inner(k[1])}</m:sub></m:sSub>`;
      case 'msubsup': return `<m:sSubSup>${e(k[0])}<m:sub>${inner(k[1])}</m:sub><m:sup>${inner(k[2])}</m:sup></m:sSubSup>`;
      case 'mover': {
        if (n.getAttribute('accent') === 'true') {
          const ch = k[1] ? k[1].textContent : '^';
          const rev = { '^': '̂', '~': '̃', '˙': '̇', '¨': '̈', '→': '⃗', 'ˇ': '̌', '˘': '̆', '´': '́', '`': '̀' };
          if (ch === '¯') return `<m:bar><m:barPr><m:pos m:val="top"/></m:barPr>${e(k[0])}</m:bar>`;
          return `<m:acc><m:accPr><m:chr m:val="${esc(rev[ch] || ch)}"/></m:accPr>${e(k[0])}</m:acc>`;
        }
        if (k[1] && /^[⏞⏟︷︸]$/.test(k[1].textContent)) return `<m:groupChr><m:groupChrPr><m:chr m:val="${esc(k[1].textContent)}"/><m:pos m:val="top"/></m:groupChrPr>${e(k[0])}</m:groupChr>`;
        return `<m:limUpp>${e(k[0])}<m:lim>${inner(k[1])}</m:lim></m:limUpp>`;
      }
      case 'munder': {
        if (n.getAttribute('accentunder') === 'true') return `<m:bar><m:barPr><m:pos m:val="bot"/></m:barPr>${e(k[0])}</m:bar>`;
        if (k[1] && /^[⏞⏟︷︸]$/.test(k[1].textContent)) return `<m:groupChr>${e(k[0])}</m:groupChr>`;
        return `<m:limLow>${e(k[0])}<m:lim>${inner(k[1])}</m:lim></m:limLow>`;
      }
      case 'munderover': return `<m:limUpp><m:e><m:limLow>${e(k[0])}<m:lim>${inner(k[1])}</m:lim></m:limLow></m:e><m:lim>${inner(k[2])}</m:lim></m:limUpp>`;
      case 'mtable': return `<m:m>${k.map((row) => `<m:mr>${els(row).map((cell) => `<m:e>${els(cell).map(toOmml).join('')}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
      case 'menclose': return `<m:borderBox><m:e>${k.map(toOmml).join('')}</m:e></m:borderBox>`;
      case 'mmultiscripts': return `<m:sPre><m:sub>${inner(k[2])}</m:sub><m:sup>${inner(k[3])}</m:sup>${e(k[0])}</m:sPre>`;
      default: return k.map(toOmml).join('');
    }
  }
  const x0 = (n) => n.textContent.replace(/\s+/g, ' ');
  function naryOf(x) {
    const isOp = (o) => o && ln(o) === 'mo' && o.getAttribute('largeop') === 'true';
    const nm = ln(x);
    if (isOp(x)) return { chr: x.textContent, loc: 'undOvr' };
    const k = els(x);
    if (!isOp(k[0])) return null;
    const chr = k[0].textContent;
    if (nm === 'munderover') return { chr, loc: 'undOvr', sub: k[1], sup: k[2] };
    if (nm === 'msubsup') return { chr, loc: 'subSup', sub: k[1], sup: k[2] };
    if (nm === 'munder') return { chr, loc: 'undOvr', sub: k[1] };
    if (nm === 'msub') return { chr, loc: 'subSup', sub: k[1] };
    if (nm === 'mover') return { chr, loc: 'undOvr', sup: k[1] };
    if (nm === 'msup') return { chr, loc: 'subSup', sup: k[1] };
    return null;
  }
  /** MathML element -> OMML string (<m:oMath>, or <m:oMathPara> for display equations) */
  function mathmlToOmml(mathEl) {
    const body = `<m:oMath xmlns:m="${NS_M}" xmlns:w="${NS_W}">${toOmml(mathEl)}</m:oMath>`;
    return mathEl.getAttribute && mathEl.getAttribute('display') === 'block' ? `<m:oMathPara xmlns:m="${NS_M}" xmlns:w="${NS_W}">${body}</m:oMathPara>` : body;
  }

  // ---------------------------------------------------------------- MathML -> LaTeX (to edit an equation)
  const REV = {};
  for (const [k, v] of Object.entries(GREEK)) REV[v] = '\\' + k + ' ';
  for (const [k, v] of Object.entries(SYMS)) if (v && v.trim() && !REV[v] && k.length > 1) REV[v] = '\\' + k + ' ';
  for (const [k, v] of Object.entries(BIGOPS)) REV[v] = '\\' + k;
  Object.assign(REV, { '−': '-', '·': '\\cdot ', '×': '\\times ', '{': '\\{', '}': '\\}' });
  function toTex(n) {
    if (!n) return '';
    if (n.nodeType === 3) return n.nodeValue;
    if (n.nodeType !== 1) return '';
    const k = els(n);
    const g = (x) => { const t = toTex(x).trim(); return t.length === 1 || /^\\[A-Za-z]+$/.test(t) ? t + (/^\\/.test(t) ? ' ' : '') : `{${t}}`; };
    const txt = (x) => Array.from(x.textContent).map((ch) => REV[ch] || ch).join('');
    switch (ln(n)) {
      case 'math': case 'mrow': case 'mstyle': case 'semantics': {
        if (k.length >= 2 && ln(k[0]) === 'mo' && k[0].getAttribute('fence') === 'true') {
          const l = k[0].textContent, last = k[k.length - 1];
          const closes = ln(last) === 'mo' && last.getAttribute('fence') === 'true' && k.length > 1;
          const fix = (c) => (c === '{' ? '\\{' : c === '}' ? '\\}' : c || '.');
          if (k.length === 3 && ln(k[1]) === 'mtable') {
            const env = { '(': 'pmatrix', '[': 'bmatrix', '{': closes ? 'Bmatrix' : 'cases', '|': 'vmatrix' }[l] || 'matrix';
            return `\\begin{${env}}${tableTex(k[1])}\\end{${env}}`;
          }
          if (!closes && k.length === 2 && ln(k[1]) === 'mtable' && l === '{') return `\\begin{cases}${tableTex(k[1])}\\end{cases}`;
          return `\\left${fix(l)} ${k.slice(1, closes ? -1 : undefined).map(toTex).join('')} \\right${fix(closes ? last.textContent : '')}`;
        }
        return k.map(toTex).join('');
      }
      case 'mi': { const t = n.textContent; if (t.length > 1) return FUNCS.has(t) ? `\\${t} ` : `\\mathrm{${t}}`; return txt(n); }
      case 'mn': return n.textContent;
      case 'mo': return n.textContent === '⁡' ? '' : txt(n);
      case 'mtext': return `\\text{${n.textContent}}`;
      case 'mspace': return '\\,';
      case 'mfrac': return `\\frac{${toTex(k[0])}}{${toTex(k[1])}}`;
      case 'msqrt': return `\\sqrt{${k.map(toTex).join('')}}`;
      case 'mroot': return `\\sqrt[${toTex(k[1])}]{${toTex(k[0])}}`;
      case 'msup': return `${g(k[0])}^${g(k[1])}`;
      case 'msub': return `${g(k[0])}_${g(k[1])}`;
      case 'msubsup': case 'munderover': return `${g(k[0])}_${g(k[1])}^${g(k[2])}`;
      case 'munder': return n.getAttribute('accentunder') === 'true' ? `\\underline{${toTex(k[0])}}` : `${g(k[0])}_${g(k[1])}`;
      case 'mover': {
        if (n.getAttribute('accent') === 'true') { const a = { '^': 'hat', '~': 'tilde', '¯': 'overline', '→': 'vec', '˙': 'dot', '¨': 'ddot' }[k[1] && k[1].textContent] || 'hat'; return `\\${a}{${toTex(k[0])}}`; }
        return `${g(k[0])}^${g(k[1])}`;
      }
      case 'mtable': return `\\begin{matrix}${tableTex(n)}\\end{matrix}`;
      default: return k.map(toTex).join('');
    }
  }
  const tableTex = (t) => els(t).map((r) => els(r).map((c) => toTex(c)).join(' & ')).join(' \\\\ ');
  function mathmlToLatex(mathEl) { return toTex(mathEl).replace(/\s+/g, ' ').trim(); }

  return { ommlToMathml, latexToMathml, mathmlToOmml, mathmlToLatex, NS_M, NS_W };
});
