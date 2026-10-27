// DWG -> DXF bytes. Everything else about drawings (parsing, geometry, editing, DXF writing)
// lives in the Rust engine in the renderer.
//
// Big drawings: the converter runs as a separate native program (LibreDWG dwg2dxf, built for
// Windows) so it can use all of the computer's memory; the WebAssembly build of LibreDWG is limited
// to 4 GB and is only a fallback. The DXF it writes is then compacted (handles, owner links, Z
// coordinates, the OBJECTS section… are dropped) so the engine gets roughly half the bytes.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

let libPromise = null;
async function getLibreDwg() {
  if (!libPromise) {
    libPromise = (async () => {
      const mod = await import('@mlightcad/libredwg-web');
      const pkgDir = path.join(path.dirname(require.resolve('@mlightcad/libredwg-web')), '..');
      // inside a packaged app the wasm lives in app.asar.unpacked
      const wasmDir = path.join(pkgDir, 'wasm').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      return mod.LibreDwg.create(wasmDir + path.sep);
    })();
  }
  return libPromise;
}

async function dwgToDxfWasm(buffer) {
  const lib = await getLibreDwg();
  const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length);
  const out = lib.dwg_write_dxf(ab);
  if (!out || !out.length) throw new Error('Не удалось прочитать DWG (версия не поддерживается или файл повреждён)');
  return Buffer.from(out);
}

/** path of the native converter for this platform, or null */
function nativeConverter() {
  const name = process.platform === 'win32' ? 'win/dwg2dxf.exe' : process.platform === 'linux' ? 'linux/dwg2dxf' : null;
  if (!name) return null;
  const candidates = [
    process.resourcesPath && path.join(process.resourcesPath, 'bin', name), // packaged app
    path.join(__dirname, '..', '..', 'bin', name), // development
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/** Runs dwg2dxf in a temporary folder with plain ASCII file names (user paths may contain Cyrillic). */
function dwgToDxfNative(exe, srcPath) {
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osdwg-'));
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
    try {
      fs.copyFileSync(srcPath, path.join(dir, 'in.dwg'));
    } catch (e) {
      cleanup();
      return reject(e);
    }
    const p = spawn(exe, ['-y', '-o', 'out.dxf', 'in.dwg'], { cwd: dir, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    p.on('error', (e) => { cleanup(); reject(e); });
    p.on('close', (code) => {
      const out = path.join(dir, 'out.dxf');
      let ok = false;
      try { ok = fs.statSync(out).size > 100; } catch {}
      if (!ok) { cleanup(); return reject(new Error(`dwg2dxf: код ${code}. ${err.trim().split('\n').slice(-2).join(' ')}`)); }
      try { resolve(compactDxf(out)); } catch (e) { reject(e); } finally { cleanup(); }
    });
  });
}

// group codes the engine never reads: handles, owners/reactors, subclass markers, Z values, comments
const DROP = new Set([5, 105, 330, 340, 350, 360, 100, 102, 30, 31, 32, 33, 34, 36, 37, 38, 39, 999]);
const DROP_SECTIONS = new Set(['OBJECTS', 'CLASSES', 'THUMBNAILIMAGE', 'ACDSDATA']);

const DROP_TABLE = new Uint8Array(1100);
for (const c of DROP) DROP_TABLE[c] = 1;

/** Streams a DXF file and writes only what the engine uses. Returns a Buffer. */
function compactDxf(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const out = Buffer.allocUnsafe(size + 64);
  let o = 0;
  const CH = 32 * 1024 * 1024;
  const buf = Buffer.allocUnsafe(CH);
  // carried partial pair from the previous chunk
  let carry = Buffer.alloc(0);
  let section = '';
  let afterSection = false;
  let skip = false;
  let pos = 0;
  const sectionName = (d, a, b) => d.toString('latin1', a, b).trim();
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, CH, pos);
      pos += n;
      const last = n <= 0;
      const d = carry.length ? Buffer.concat([carry, buf.subarray(0, Math.max(n, 0))]) : buf.subarray(0, Math.max(n, 0));
      const len = d.length;
      let i = 0;
      // process complete pairs: code line + value line
      for (;;) {
        const e1 = d.indexOf(10, i);
        if (e1 < 0) break;
        let e2 = d.indexOf(10, e1 + 1);
        if (e2 < 0) { if (!last) break; e2 = len; }
        // parse group code
        let k = i, code = 0, neg = false, digits = 0;
        while (k < e1 && d[k] === 32) k++;
        if (d[k] === 45) { neg = true; k++; }
        while (k < e1) { const c = d[k]; if (c < 48 || c > 57) break; code = code * 10 + c - 48; k++; digits++; }
        if (neg) code = -code;
        // value bounds (strip \r)
        const va = e1 + 1;
        let vb = e2;
        if (vb > va && d[vb - 1] === 13) vb--;
        const pairStart = i;
        i = e2 + 1;
        if (!digits) continue;
        if (code === 0) {
          let a = va, b = vb;
          while (a < b && d[a] === 32) a++;
          while (b > a && d[b - 1] === 32) b--;
          const l = b - a;
          // SECTION / ENDSEC detection without building strings for every entity
          if (l === 7 && d[a] === 83 && d.toString('latin1', a, b) === 'SECTION') { afterSection = true; skip = false; }
          else if (l === 6 && d[a] === 69 && d.toString('latin1', a, b) === 'ENDSEC') { afterSection = false; skip = false; section = ''; }
          else { afterSection = false; if (skip) continue; }
          out[o++] = 48; out[o++] = 10;
          o += d.copy(out, o, a, b); out[o++] = 10;
          continue;
        }
        if (afterSection && code === 2) {
          afterSection = false;
          section = sectionName(d, va, vb);
          skip = DROP_SECTIONS.has(section);
        } else {
          if (skip) continue;
          if (code < 1100 && DROP_TABLE[code] === 1 && section !== 'HEADER') continue;
          if (code >= 1000 && code <= 1071 && section !== 'TABLES') continue;
        }
        // copy code digits and value
        o += d.copy(out, o, pairStart, e1 > pairStart && d[e1 - 1] === 13 ? e1 - 1 : e1); out[o++] = 10;
        o += d.copy(out, o, va, vb); out[o++] = 10;
      }
      if (last) break;
      carry = Buffer.from(d.subarray(i));
    }
    if (out.toString('latin1', Math.max(0, o - 4), o) !== 'EOF\n') o += out.write('0\nEOF\n', o, 'latin1');
  } finally {
    fs.closeSync(fd);
  }
  return out.subarray(0, o);
}

/** Returns ASCII DXF bytes for a .dwg or .dxf file */
async function cadFileToDxf(buffer, filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.dwg' || buffer.slice(0, 4).toString('latin1') === 'AC10') {
    const exe = nativeConverter();
    if (exe && filePath) {
      try {
        return await dwgToDxfNative(exe, filePath);
      } catch (e) {
        console.warn('native dwg2dxf failed, falling back to WebAssembly:', e.message);
      }
    }
    try {
      return await dwgToDxfWasm(buffer);
    } catch (e) {
      throw new Error(`Не удалось прочитать DWG: ${e && e.message ? e.message : e}`);
    }
  }
  if (buffer.slice(0, 18).toString('latin1') === 'AutoCAD Binary DXF') throw new Error('Двоичный DXF не поддерживается — сохраните его как ASCII DXF');
  return buffer;
}

module.exports = { cadFileToDxf, compactDxf, nativeConverter };
