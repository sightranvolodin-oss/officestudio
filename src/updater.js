// Updates from GitHub Releases.
//  - installed copy (NSIS): electron-updater downloads the new installer (only changed blocks) and
//    reinstalls silently on restart;
//  - portable copy: the new OfficeStudio-Portable-X.exe is downloaded next to the old one, started,
//    and the old file is removed by the new version.
// The repository is set in package.json → "updateRepo": "owner/name".
const { app, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const pkg = require('../package.json');

function repo() {
  const r = (process.env.OS_UPDATE_REPO || pkg.updateRepo || '').trim();
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(r);
  return m ? { owner: m[1], name: m[2] } : null;
}
const cmpVer = (a, b) => {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

function setupUpdater(getWin, beforeInstall = () => {}) {
  const portableExe = process.env.PORTABLE_EXECUTABLE_FILE || null;
  const installed = app.isPackaged && process.platform === 'win32' && !portableExe;
  let state = { state: 'idle', current: pkg.version };
  const set = (s) => {
    state = { ...state, ...s, current: pkg.version };
    const w = getWin();
    if (w && !w.isDestroyed()) w.webContents.send('update-state', state);
  };

  // ---------------------------------------------------------------- installed copy
  let au = null;
  function updater() {
    if (au) return au;
    const r = repo();
    ({ autoUpdater: au } = require('electron-updater'));
    au.autoDownload = false;
    au.autoInstallOnAppQuit = true;
    au.allowPrerelease = false;
    au.setFeedURL({ provider: 'github', owner: r.owner, repo: r.name });
    au.on('checking-for-update', () => set({ state: 'checking' }));
    au.on('update-available', (i) => set({ state: 'available', version: i.version, notes: notesText(i.releaseNotes) }));
    au.on('update-not-available', () => set({ state: 'none' }));
    au.on('download-progress', (p) => set({ state: 'downloading', percent: Math.round(p.percent) }));
    au.on('update-downloaded', (i) => set({ state: 'ready', version: i.version }));
    au.on('error', (e) => set({ state: 'error', error: friendly(e) }));
    return au;
  }

  // ---------------------------------------------------------------- portable copy / development
  let latest = null; // { version, asset: {url, name, size}, notes }
  let downloaded = null;
  async function checkPortable() {
    const r = repo();
    set({ state: 'checking' });
    const res = await net.fetch(`${process.env.OS_UPDATE_API || 'https://api.github.com'}/repos/${r.owner}/${r.name}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OfficeStudio' }, signal: AbortSignal.timeout(20000) });
    if (res.status === 404) return set({ state: 'none' });
    if (!res.ok) throw new Error('GitHub ответил ' + res.status);
    const rel = await res.json();
    const version = String(rel.tag_name || rel.name || '').replace(/^v/, '');
    const asset = (rel.assets || []).find((a) => /Portable.*\.exe$/i.test(a.name));
    if (!version || cmpVer(version, pkg.version) <= 0 || !asset) return set({ state: 'none' });
    latest = { version, asset: { url: asset.browser_download_url, name: asset.name, size: asset.size }, notes: rel.body || '' };
    set({ state: 'available', version, notes: notesText(latest.notes) });
  }
  async function downloadPortable() {
    if (!latest) await checkPortable();
    if (!latest) return;
    const dirs = [portableExe && path.dirname(portableExe), app.getPath('downloads')].filter(Boolean);
    let target = null;
    for (const d of dirs) {
      try { fs.accessSync(d, fs.constants.W_OK); target = path.join(d, latest.asset.name); break; } catch {}
    }
    if (!target) throw new Error('Нет папки, куда можно сохранить обновление');
    const tmp = target + '.download';
    set({ state: 'downloading', percent: 0, version: latest.version });
    const res = await net.fetch(latest.asset.url, { headers: { 'User-Agent': 'OfficeStudio' } });
    if (!res.ok || !res.body) throw new Error('Не удалось скачать: ' + res.status);
    const total = +res.headers.get('content-length') || latest.asset.size || 0;
    const out = fs.createWriteStream(tmp);
    const reader = res.body.getReader();
    let got = 0, lastPct = -1;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct) { lastPct = pct; set({ state: 'downloading', percent: pct }); }
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (total && got !== total) { fs.rmSync(tmp, { force: true }); throw new Error('Файл скачался не полностью'); }
    fs.renameSync(tmp, target);
    downloaded = target;
    set({ state: 'ready', version: latest.version });
  }
  function installPortable() {
    if (!downloaded) return;
    // let the new copy take the single-instance lock, then hand over
    app.releaseSingleInstanceLock();
    const args = portableExe ? ['--os-updated-from', portableExe] : [];
    try { if (process.platform !== 'win32') fs.chmodSync(downloaded, 0o755); } catch {}
    let child;
    try {
      child = spawn(downloaded, args, { detached: true, stdio: 'ignore', cwd: path.dirname(downloaded) });
    } catch (e) {
      set({ state: 'error', error: 'Не удалось запустить новую версию: ' + e.message });
      return;
    }
    child.on('error', (e) => set({ state: 'error', error: 'Не удалось запустить новую версию: ' + e.message }));
    child.on('spawn', () => { child.unref(); setTimeout(() => app.exit(0), 300); });
  }

  // ---------------------------------------------------------------- IPC
  async function check(manual) {
    if (!repo()) return set({ state: 'unconfigured' });
    try {
      if (installed) await updater().checkForUpdates();
      else await checkPortable();
    } catch (e) {
      set({ state: manual ? 'error' : 'idle', error: friendly(e) });
    }
  }
  ipcMain.handle('update-get', () => state);
  ipcMain.handle('update-check', () => check(true));
  ipcMain.handle('update-download', async () => {
    try {
      if (installed) await updater().downloadUpdate();
      else await downloadPortable();
    } catch (e) {
      set({ state: 'error', error: friendly(e) });
    }
  });
  ipcMain.handle('update-install', () => {
    beforeInstall();
    if (installed) { updater().quitAndInstall(true, true); return; }
    installPortable();
  });

  // first check shortly after start, then every 4 hours
  if (app.isPackaged) {
    setTimeout(() => check(false), 6000);
    setInterval(() => check(false), 4 * 3600 * 1000);
  }
  cleanupOldPortable();
}

/** the new portable copy removes the one it replaced */
function cleanupOldPortable() {
  const i = process.argv.indexOf('--os-updated-from');
  if (i < 0) return;
  const old = process.argv[i + 1];
  const self = process.env.PORTABLE_EXECUTABLE_FILE;
  if (!old || !/OfficeStudio-Portable-[\d.]+\.exe$/i.test(old) || (self && path.resolve(old) === path.resolve(self))) return;
  let tries = 0;
  const t = setInterval(() => {
    tries++;
    try { fs.unlinkSync(old); clearInterval(t); } catch (e) { if (e.code === 'ENOENT' || tries > 20) clearInterval(t); }
  }, 1500);
}

function notesText(n) {
  if (!n) return '';
  if (Array.isArray(n)) n = n.map((x) => x.note || '').join('\n');
  return String(n).replace(/<[^>]+>/g, '').replace(/\r/g, '').trim().slice(0, 1500);
}
function friendly(e) {
  const m = String((e && e.message) || e || '');
  if (/ENOTFOUND|ERR_INTERNET|ERR_NAME_NOT_RESOLVED|ECONNRE|ETIMEDOUT|net::/i.test(m)) return 'Нет связи с сервером обновлений. Проверьте интернет.';
  if (/404/.test(m)) return 'Обновления ещё не опубликованы.';
  return m.split('\n')[0].slice(0, 300);
}

module.exports = { setupUpdater, cmpVer };
