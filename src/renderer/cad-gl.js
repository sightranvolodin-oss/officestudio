/* Rust engine loader + WebGL2 renderer for drawings */
(function () {
  // ------------------------------------------------------------ engine (WebAssembly)
  let loading = null;
  const CadCore = {
    load() {
      if (!loading) {
        loading = (async () => {
          const bytes = await window.api.readWasm();
          const out = await wasm_bindgen({ module_or_path: bytes });
          CadCore.memory = out.memory;
          CadCore.Engine = wasm_bindgen.Engine;
        })();
      }
      return loading;
    },
    f32(ptr, len) { return new Float32Array(CadCore.memory.buffer, ptr, len); },
    u32(ptr, len) { return new Uint32Array(CadCore.memory.buffer, ptr, len); },
    u16(ptr, len) { return new Uint16Array(CadCore.memory.buffer, ptr, len); },
  };

  const VS = `#version 300 es
in vec2 aPos;
in vec4 aCol;
in uint aLay;
uniform vec2 uOff;
uniform vec2 uScale;
uniform mat3 uM;
uniform highp sampler2D uLayers; // per layer: rgb colour, a = opacity (0 = layer hidden)
uniform vec3 uFg;
uniform int uFixed;
uniform vec3 uFixedCol;
uniform int uMode; // 0 as is, 1 darken light colours (light background), 2 monochrome
out vec3 vCol;
out float vA;
void main() {
  vec2 p = (uM * vec3(aPos, 1.0)).xy;
  gl_Position = vec4((p - uOff) * uScale, 0.0, 1.0);
  if (uFixed == 1) { vCol = uFixedCol; vA = 1.0; return; }
  int li = int(aLay);
  vec4 L = texelFetch(uLayers, ivec2(li % 1024, li / 1024), 0);
  if (L.a < 0.002) { gl_Position = vec4(4.0, 4.0, 4.0, 1.0); vCol = vec3(0.0); vA = 0.0; return; }
  // explicit colour: rgb + own opacity; ByLayer: layer colour, own opacity in r when g marks it
  bool own = aCol.a > 0.002;
  vec3 c = own ? aCol.rgb : L.rgb;
  vA = own ? aCol.a : (aCol.g > 0.002 ? aCol.r : L.a);
  // ACI 7: white on dark background, black on light
  if (all(greaterThan(c, vec3(0.98))) || all(lessThan(c, vec3(0.02)))) c = uFg;
  else if (uMode == 2) c = uFg;
  else if (uMode == 1) { float l = dot(c, vec3(0.299, 0.587, 0.114)); if (l > 0.45) c *= 0.45 / l; }
  vCol = c;
}`;
  const FS = `#version 300 es
precision mediump float;
in vec3 vCol;
in float vA;
out vec4 o;
void main() { o = vec4(vCol * vA, vA); }`;

  const FAR = 3e38; // hidden vertices are moved far outside the view

  class GLView {
    constructor(canvas) {
      const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false });
      if (!gl) throw new Error('WebGL2 недоступен');
      this.gl = gl;
      this.canvas = canvas;
      // software rasterisers (no real GPU) are slower than the culled 2D fallback
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.rendererName = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      this.software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(this.rendererName);
      const sh = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.bindAttribLocation(p, 1, 'aCol');
      gl.bindAttribLocation(p, 2, 'aLay');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      this.prog = p;
      this.u = {};
      for (const n of ['uOff', 'uScale', 'uM', 'uLayers', 'uFg', 'uFixed', 'uFixedCol', 'uMode']) this.u[n] = gl.getUniformLocation(p, n);
      this.sets = { base: this.makeSet(), overlay: this.makeSet() };
      this.sel = { vao: gl.createVertexArray(), pos: gl.createBuffer(), count: 0 };
      gl.bindVertexArray(this.sel.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sel.pos);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(1);
      gl.vertexAttrib4f(1, 0, 0, 0, 1);
      gl.disableVertexAttribArray(2);
      gl.vertexAttribI4ui(2, 0, 0, 0, 0);
      gl.bindVertexArray(null);
      this.far = new Float32Array(0);
      this.layerTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.layerData = new Uint8Array(0);
    }
    makeSet() {
      const gl = this.gl;
      const mk = () => {
        const o = { vao: gl.createVertexArray(), pos: gl.createBuffer(), col: gl.createBuffer(), lay: gl.createBuffer() };
        gl.bindVertexArray(o.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, o.pos);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, o.col);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, o.lay);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribIPointer(2, 1, gl.UNSIGNED_SHORT, 0, 0);
        gl.bindVertexArray(null);
        return o;
      };
      return { lines: mk(), tris: mk(), groups: new Uint32Array(0) };
    }
    /** upload a buffer set chunk by chunk straight from wasm memory (no intermediate copies) */
    upload(name, eng) {
      const gl = this.gl;
      const set = this.sets[name];
      const pre = name === 'base' ? 'base' : 'ov';
      const groups = new Uint32Array(eng[pre + '_groups']());
      [set.lines, set.tris].forEach((o, kind) => {
        const total = eng[pre + '_total'](kind);
        gl.bindBuffer(gl.ARRAY_BUFFER, o.pos);
        gl.bufferData(gl.ARRAY_BUFFER, total * 8, gl.STATIC_DRAW);
        for (let i = 0; i < groups.length; i += 5) {
          if (groups[i] !== kind) continue;
          gl.bufferSubData(gl.ARRAY_BUFFER, groups[i + 2] * 8, CadCore.f32(eng[pre + '_chunk_pos'](groups[i + 4]), groups[i + 3] * 2));
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, o.col);
        gl.bufferData(gl.ARRAY_BUFFER, total * 4, gl.STATIC_DRAW);
        for (let i = 0; i < groups.length; i += 5) {
          if (groups[i] !== kind) continue;
          gl.bufferSubData(gl.ARRAY_BUFFER, groups[i + 2] * 4, CadCore.u32(eng[pre + '_chunk_col'](groups[i + 4]), groups[i + 3]));
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, o.lay);
        gl.bufferData(gl.ARRAY_BUFFER, Math.max(4, total * 2), gl.STATIC_DRAW);
        for (let i = 0; i < groups.length; i += 5) {
          if (groups[i] !== kind) continue;
          gl.bufferSubData(gl.ARRAY_BUFFER, groups[i + 2] * 2, CadCore.u16(eng[pre + '_chunk_lay'](groups[i + 4]), groups[i + 3]));
        }
      });
      set.groups = groups;
    }
    /** hide base vertex ranges [kind, start, count]* */
    hide(ranges) {
      const gl = this.gl;
      for (let i = 0; i < ranges.length; i += 3) {
        const o = ranges[i] === 0 ? this.sets.base.lines : this.sets.base.tris;
        const n = ranges[i + 2] * 2;
        if (this.far.length < n) { this.far = new Float32Array(Math.max(n, 4096)); this.far.fill(FAR); }
        gl.bindBuffer(gl.ARRAY_BUFFER, o.pos);
        gl.bufferSubData(gl.ARRAY_BUFFER, ranges[i + 1] * 8, this.far, 0, n);
      }
    }
    uploadSel(eng) {
      const gl = this.gl;
      const len = eng.sel_len();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.sel.pos);
      gl.bufferData(gl.ARRAY_BUFFER, len ? CadCore.f32(eng.sel_ptr(), len) : new Float32Array(0), gl.DYNAMIC_DRAW);
      this.sel.count = len / 2;
    }
    resize(w, h, dpr) {
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    }
    /**
     * view: {cx, cy, s, W, H}; origin [ox, oy]; layers: [{color:[r,g,b], visible}] by index;
     * fg: [r,g,b]; sel: {matrix?: [a,b,c,d,e,f] world-space, color}
     */
    draw(view, origin, layers, fg, sel, mode = 0) {
      const gl = this.gl;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.prog);
      // premultiplied alpha blending for transparent layers / objects
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniform2f(this.u.uOff, view.cx - origin[0], view.cy - origin[1]);
      gl.uniform2f(this.u.uScale, (2 * view.s) / view.W, (2 * view.s) / view.H);
      gl.uniformMatrix3fv(this.u.uM, false, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
      gl.uniform3fv(this.u.uFg, fg);
      gl.uniform1i(this.u.uFixed, 0);
      gl.uniform1i(this.u.uMode, mode);
      this.uploadLayers(layers);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
      gl.uniform1i(this.u.uLayers, 0);
      for (const name of ['base', 'overlay']) {
        const set = this.sets[name];
        const g = set.groups;
        // fills first (in drawing order), then lines on top
        for (const pass of [1, 0]) {
          const o = pass === 0 ? set.lines : set.tris;
          gl.bindVertexArray(o.vao);
          for (let i = 0; i < g.length; i += 5) {
            if (g[i] !== pass) continue;
            gl.drawArrays(pass === 0 ? gl.LINES : gl.TRIANGLES, g[i + 2], g[i + 3]);
          }
        }
      }
      if (sel && this.sel.count) {
        // selection outline; with a matrix it becomes a live move/rotate/mirror preview
        const m = sel.matrix;
        if (m) {
          // world transform M, expressed for origin-relative coordinates: p' = A p + (A o + t - o)
          const [a, b, c, d, e, f] = m;
          const [ox, oy] = origin;
          const tx = a * ox + c * oy + e - ox, ty = b * ox + d * oy + f - oy;
          gl.uniformMatrix3fv(this.u.uM, false, [a, b, 0, c, d, 0, tx, ty, 1]);
        }
        gl.uniform1i(this.u.uFixed, 1);
        gl.uniform3fv(this.u.uFixedCol, sel.color || [0.3, 0.64, 1]);
        gl.bindVertexArray(this.sel.vao);
        gl.drawArrays(gl.LINES, 0, this.sel.count);
      }
      gl.bindVertexArray(null);
    }
  }

  /** per-layer colour/opacity/visibility as RGBA texels (1024 per row) */
  GLView.prototype.uploadLayers = function (layers) {
    const gl = this.gl;
    const n = Math.max(1, layers.length);
    const rows = Math.ceil(n / 1024), w = Math.min(n, 1024);
    const need = w * rows * 4;
    if (this.layerData.length !== need) this.layerData = new Uint8Array(need);
    const d = this.layerData;
    d.fill(0);
    for (let i = 0; i < layers.length; i++) {
      const L = layers[i];
      const c = L ? L.color : [1, 1, 1];
      d[i * 4] = c[0] * 255; d[i * 4 + 1] = c[1] * 255; d[i * 4 + 2] = c[2] * 255;
      d[i * 4 + 3] = L && !L.visible ? 0 : Math.max(1, L && L.alpha != null ? L.alpha : 255);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.layerTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
  };

  /** Fallback when WebGL2 is unavailable: same interface, draws with Canvas 2D (slower on huge drawings) */
  class Canvas2DView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) throw new Error('Canvas недоступен');
      this.sets = { base: { groups: new Uint32Array(0) }, overlay: { groups: new Uint32Array(0) } };
      this.sel = { pos: new Float32Array(0), count: 0 };
      this.software = true;
    }
    upload(name, eng) {
      const pre = name === 'base' ? 'base' : 'ov';
      const groups = new Uint32Array(eng[pre + '_groups']());
      const mk = (kind) => {
        const total = eng[pre + '_total'](kind);
        const o = { pos: new Float32Array(total * 2), col: new Uint32Array(total), lay: new Uint16Array(total) };
        for (let i = 0; i < groups.length; i += 5) {
          if (groups[i] !== kind) continue;
          o.pos.set(CadCore.f32(eng[pre + '_chunk_pos'](groups[i + 4]), groups[i + 3] * 2), groups[i + 2] * 2);
          o.col.set(CadCore.u32(eng[pre + '_chunk_col'](groups[i + 4]), groups[i + 3]), groups[i + 2]);
          o.lay.set(CadCore.u16(eng[pre + '_chunk_lay'](groups[i + 4]), groups[i + 3]), groups[i + 2]);
        }
        return o;
      };
      this.sets[name] = { lines: mk(0), tris: mk(1), groups };
    }
    hide(ranges) {
      for (let i = 0; i < ranges.length; i += 3) {
        const o = ranges[i] === 0 ? this.sets.base.lines : this.sets.base.tris;
        o.pos.fill(FAR, ranges[i + 1] * 2, (ranges[i + 1] + ranges[i + 2]) * 2);
      }
    }
    uploadSel(eng) {
      const len = eng.sel_len();
      this.sel.pos = len ? CadCore.f32(eng.sel_ptr(), len).slice() : new Float32Array(0);
      this.sel.count = len / 2;
    }
    resize(w, h, dpr) {
      this.canvas.width = Math.max(1, Math.round(w * dpr));
      this.canvas.height = Math.max(1, Math.round(h * dpr));
      this.dpr = dpr;
    }
    draw(view, origin, layers, fg, sel, mode = 0) {
      const ctx = this.ctx, d = this.dpr || 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      const s = view.s;
      // origin-relative world -> device pixels
      ctx.setTransform(d * s, 0, 0, -d * s, d * (view.W / 2 - (view.cx - origin[0]) * s), d * (view.H / 2 + (view.cy - origin[1]) * s));
      const lw = 1 / s;
      const alphaOf = (v, L) => {
        const a = (v >>> 24) & 255;
        if (a) return a / 255;
        if ((v >>> 8) & 255) return (v & 255) / 255;
        return L && L.alpha != null ? L.alpha / 255 : 1;
      };
      const hexOf = (v, L) => {
        let r, g, b;
        if ((v >>> 24) & 255) { r = v & 255; g = (v >>> 8) & 255; b = (v >>> 16) & 255; }
        else { const c = L ? L.color : [1, 1, 1]; r = c[0] * 255; g = c[1] * 255; b = c[2] * 255; }
        if ((r > 250 && g > 250 && b > 250) || (r < 5 && g < 5 && b < 5) || mode === 2) return `rgb(${fg[0] * 255},${fg[1] * 255},${fg[2] * 255})`;
        if (mode === 1) { const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255; if (l > 0.45) { r *= 0.45 / l; g *= 0.45 / l; b *= 0.45 / l; } }
        return `rgb(${r | 0},${g | 0},${b | 0})`;
      };
      // visible window in origin-relative coordinates, for culling
      const x1 = view.cx - origin[0] - view.W / 2 / s, x2 = view.cx - origin[0] + view.W / 2 / s;
      const y1 = view.cy - origin[1] - view.H / 2 / s, y2 = view.cy - origin[1] + view.H / 2 / s;
      ctx.lineWidth = lw;
      for (const name of ['base', 'overlay']) {
        const set = this.sets[name];
        const g = set.groups;
        for (const pass of [1, 0]) {
          for (let i = 0; i < g.length; i += 5) {
            if (g[i] !== pass) continue;
            const o = pass === 0 ? set.lines : set.tris;
            const p = o.pos, col = o.col, lay = o.lay;
            const per = pass === 0 ? 2 : 3;
            let cur = -1, curL = -1;
            ctx.beginPath();
            for (let v = g[i + 2], end = g[i + 2] + g[i + 3]; v < end; v += per) {
              const ax = p[v * 2], ay = p[v * 2 + 1], bx = p[v * 2 + 2], by = p[v * 2 + 3];
              if ((ax < x1 && bx < x1) || (ax > x2 && bx > x2) || (ay < y1 && by < y1) || (ay > y2 && by > y2)) continue;
              const li = lay[v];
              const L = layers[li];
              if (L && !L.visible) continue;
              if (col[v] !== cur || li !== curL) {
                if (cur !== -1) pass === 0 ? ctx.stroke() : ctx.fill();
                cur = col[v];
                curL = li;
                ctx.beginPath();
                ctx.strokeStyle = ctx.fillStyle = hexOf(cur, L);
                ctx.globalAlpha = alphaOf(cur, L);
              }
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              if (pass === 1) { ctx.lineTo(p[v * 2 + 4], p[v * 2 + 5]); ctx.closePath(); }
            }
            if (cur !== -1) pass === 0 ? ctx.stroke() : ctx.fill();
          }
        }
      }
      ctx.globalAlpha = 1;
      if (sel && this.sel.count) {
        if (sel.matrix) {
          const [a, b, c, dd, e, f] = sel.matrix;
          const [ox, oy] = origin;
          ctx.transform(a, b, c, dd, a * ox + c * oy + e - ox, b * ox + dd * oy + f - oy);
        }
        const col = sel.color || [0.3, 0.64, 1];
        ctx.strokeStyle = `rgb(${col[0] * 255},${col[1] * 255},${col[2] * 255})`;
        ctx.lineWidth = lw * 1.5;
        ctx.beginPath();
        const p = this.sel.pos;
        for (let v = 0; v < this.sel.count; v += 2) { ctx.moveTo(p[v * 2], p[v * 2 + 1]); ctx.lineTo(p[v * 2 + 2], p[v * 2 + 3]); }
        ctx.stroke();
      }
    }
  }

  /** same colour rule as the shader, for texts drawn on canvas: returns '#rrggbb' */
  function adjustColor(hex, fgHex, mode) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if ((r > 250 && g > 250 && b > 250) || (r < 5 && g < 5 && b < 5) || mode === 2) return fgHex;
    if (mode === 1) { const l = (0.299 * r + 0.587 * g + 0.114 * b) / 255; if (l > 0.45) { r *= 0.45 / l; g *= 0.45 / l; b *= 0.45 / l; } }
    return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  window.adjustCadColor = adjustColor;
  window.CadCore = CadCore;
  window.GLView = GLView;
  window.Canvas2DView = Canvas2DView;
})();
