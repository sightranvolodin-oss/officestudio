/* Application shell: tabs, home screen, file open/save, global shortcuts */
(function () {
  const { el, icon, toast, modal, esc } = UI;
  const KIND = {
    doc: { label: 'Документ', color: 'var(--doc)', hex: '#2b6cdf', badge: 'DOC', Editor: () => window.DocEditor, newName: 'Новый документ' },
    slides: { label: 'Презентация', color: 'var(--slides)', hex: '#e2702f', badge: 'PPT', Editor: () => window.SlideEditor, newName: 'Новая презентация' },
    cad: { label: 'Чертёж', color: 'var(--cad)', hex: '#1f9d6b', badge: 'DWG', Editor: () => window.CadEditor, newName: 'Новый чертёж' },
    sheet: { label: 'Таблица', color: 'var(--sheet)', hex: '#1d6f42', badge: 'XLS', Editor: () => window.SheetEditor, newName: 'Новая таблица' },
  };

  const tabsEl = document.getElementById('tabs');
  const viewsEl = document.getElementById('views');
  const tabs = [];
  let active = null;
  let counter = { doc: 0, slides: 0, cad: 0, sheet: 0 };

  // ---------------------------------------------------------------- tabs
  function addTab(t) {
    tabs.push(t);
    t.tabEl = el('div', { class: 'tab' + (t.home ? ' home' : '') });
    t.view.classList.add('view');
    viewsEl.append(t.view);
    t.tabEl.addEventListener('mousedown', (e) => { if (e.button === 0 && !e.target.closest('.x')) activate(t); if (e.button === 1 && !t.home) { e.preventDefault(); closeTab(t); } });
    tabsEl.append(t.tabEl);
    renderTab(t);
    activate(t);
    return t;
  }
  function renderTab(t) {
    if (t.home) { t.tabEl.innerHTML = `<span class="name">Главная</span>`; return; }
    t.tabEl.innerHTML = '';
    t.tabEl.title = t.path || t.name;
    t.tabEl.append(el('span', { class: 'dot', style: { background: KIND[t.kind].color } }), el('span', { class: 'name', text: t.name }));
    if (t.dirty) t.tabEl.append(el('span', { class: 'dirty', title: 'Есть несохранённые изменения' }));
    const x = el('button', { class: 'x', title: 'Закрыть (Ctrl+W)', html: icon('x', 14) });
    x.addEventListener('click', (e) => { e.stopPropagation(); closeTab(t); });
    t.tabEl.append(x);
  }
  function activate(t) {
    if (active === t) return;
    active = t;
    for (const x of tabs) {
      x.tabEl.classList.toggle('active', x === t);
      x.view.style.display = x === t ? '' : 'none';
    }
    t.tabEl.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (t.home) refreshRecent();
    if (t.editor && t.editor.onActivate) t.editor.onActivate();
    window.api.setTitle(t.home ? 'OfficeStudio' : `${t.name}${t.dirty ? ' •' : ''} — OfficeStudio`);
  }
  async function closeTab(t) {
    if (!t || t.home) return true;
    if (t.dirty) {
      activate(t);
      const r = await window.api.confirm({ message: `Сохранить изменения в «${t.name}»?`, detail: 'Если не сохранить, изменения будут потеряны.', buttons: ['Сохранить', 'Не сохранять', 'Отмена'] });
      if (r === 2) return false;
      if (r === 0 && !(await save(t, false))) return false;
    }
    t.editor && t.editor.destroy && t.editor.destroy();
    const i = tabs.indexOf(t);
    tabs.splice(i, 1);
    t.tabEl.remove();
    t.view.remove();
    if (active === t) { active = null; activate(tabs[Math.max(0, i - 1)]); }
    return true;
  }

  function makeDocTab({ kind, name, path, savePath, data, sourceExt, warnings }) {
    const t = { kind, name, path: savePath, openedFrom: path, sourceExt, dirty: false, view: el('div') };
    t.setDirty = (v) => {
      if (t.dirty === v) return;
      t.dirty = v;
      renderTab(t);
      if (active === t) window.api.setTitle(`${t.name}${t.dirty ? ' •' : ''} — OfficeStudio`);
    };
    addTab(t);
    const Editor = KIND[kind].Editor();
    t.editor = new Editor(t.view, data, { tab: t, onDirty: () => t.setDirty(true) });
    if (warnings && warnings.length) console.warn(warnings);
    if (sourceExt === '.csv') toast('CSV открыт. Форматирование и формулы сохранятся только при сохранении в .xlsx (Файл → Сохранить как).', null, 6000);
    if (sourceExt === '.dwg') toast('DWG открыт. Сохранение будет в формат DXF — его открывает AutoCAD и любые CAD-программы.', null, 6000);
    return t;
  }

  function newFile(kind) {
    counter[kind]++;
    const name = `${KIND[kind].newName}${counter[kind] > 1 ? ' ' + counter[kind] : ''}`;
    const data = kind === 'doc' ? { html: '<p><br></p>' } : kind === 'slides' ? { model: null } : { model: null };
    makeDocTab({ kind, name, data });
  }

  async function openPaths(paths) {
    for (const p of paths) {
      const existing = tabs.find((t) => t.path === p || t.openedFrom === p);
      if (existing) { activate(existing); continue; }
      const fname = p.split(/[\\/]/).pop();
      const busy = toastBusy(`Открываю ${fname}…`, /\.(dwg|dxf)$/i.test(fname) ? `Открываю ${fname}… Большой чертёж — это может занять до минуты.` : null);
      const r = await window.api.openFile(p);
      busy();
      if (!r.ok) { toast(r.error, 'error', 7000); continue; }
      const d = r.doc;
      makeDocTab({ kind: d.kind, name: d.name, path: d.path, savePath: d.savePath, sourceExt: d.sourceExt, warnings: d.warnings, data: d.kind === 'doc' ? { html: d.html, doc: d.meta || null } : d.kind === 'cad' ? { dxf: d.dxf } : { model: d.model } });
    }
  }
  function toastBusy(msg, slowMsg) {
    const t = el('div', { class: 'toast', text: msg });
    const timer = setTimeout(() => document.getElementById('toasts').append(t), 250);
    const slow = slowMsg ? setTimeout(() => { t.textContent = slowMsg; }, 5000) : null;
    return () => { clearTimeout(timer); clearTimeout(slow); t.remove(); };
  }
  async function openDialog() {
    const paths = await window.api.openDialog();
    if (paths.length) openPaths(paths);
  }

  async function save(t, saveAs) {
    t = t || active;
    if (!t || t.home) return false;
    const data = t.editor.getData();
    const suggestedName = t.name.replace(/\.(dwg|txt|md|htm)$/i, '');
    const busy = toastBusy('Сохраняю…');
    const r = await window.api.saveFile({ kind: t.kind, data, path: t.path, saveAs, suggestedName });
    busy();
    if (!r.ok) { if (!r.canceled) toast('Ошибка сохранения: ' + r.error, 'error', 7000); return false; }
    t.path = r.path;
    t.name = r.name;
    t.setDirty(false);
    renderTab(t);
    window.api.setTitle(`${t.name} — OfficeStudio`);
    toast(`Сохранено: ${r.name}`);
    return true;
  }

  async function exportActive() {
    const t = active;
    if (!t || t.home) return;
    if (t.editor.exportMenu) return t.editor.exportMenu();
  }

  // ---------------------------------------------------------------- home
  function art(kind) {
    if (kind === 'doc') return `<svg width="96" height="96" viewBox="0 0 96 96"><rect x="20" y="10" width="56" height="76" rx="6" fill="#fff" stroke="#c9d6f2" stroke-width="2"/><rect x="30" y="24" width="30" height="5" rx="2.5" fill="#2b6cdf"/><rect x="30" y="36" width="36" height="3" rx="1.5" fill="#c9d1de"/><rect x="30" y="43" width="36" height="3" rx="1.5" fill="#c9d1de"/><rect x="30" y="50" width="28" height="3" rx="1.5" fill="#c9d1de"/><rect x="30" y="60" width="36" height="14" rx="2" fill="#e7eefc"/></svg>`;
    if (kind === 'slides') return `<svg width="120" height="96" viewBox="0 0 120 96"><rect x="12" y="18" width="96" height="58" rx="6" fill="#fff" stroke="#f3d3bf" stroke-width="2"/><rect x="24" y="30" width="40" height="6" rx="3" fill="#e2702f"/><rect x="24" y="42" width="30" height="3" rx="1.5" fill="#c9d1de"/><rect x="24" y="49" width="26" height="3" rx="1.5" fill="#c9d1de"/><circle cx="84" cy="50" r="13" fill="#fde3d2"/><path d="M84 37a13 13 0 0 1 13 13H84z" fill="#e2702f"/></svg>`;
    if (kind === 'sheet') return `<svg width="120" height="96" viewBox="0 0 120 96"><rect x="14" y="14" width="92" height="68" rx="6" fill="#fff" stroke="#bfdccb" stroke-width="2"/><rect x="14" y="14" width="92" height="12" rx="6" fill="#1d6f42"/><path d="M14 40h92M14 54h92M14 68h92M40 26v56M66 26v56M86 26v56" stroke="#d3e6da" stroke-width="1.5"/><rect x="67" y="41" width="18" height="12" fill="none" stroke="#1d6f42" stroke-width="2"/><rect x="20" y="30" width="14" height="5" rx="2" fill="#9cc8ae"/><rect x="72" y="58" width="10" height="5" rx="2" fill="#1d6f42"/></svg>`;
    return `<svg width="120" height="96" viewBox="0 0 120 96"><rect x="12" y="14" width="96" height="68" rx="6" fill="#1b1e24"/><path d="M28 66V34h36v32z" fill="none" stroke="#5ee0a6" stroke-width="2"/><circle cx="80" cy="50" r="14" fill="none" stroke="#ffd166" stroke-width="2"/><path d="M28 72h36" stroke="#8a94a6" stroke-width="1.2"/><path d="M28 70v4M64 70v4" stroke="#8a94a6" stroke-width="1.2"/><path d="M64 34 80 50" stroke="#ef476f" stroke-width="2"/></svg>`;
  }
  const bgs = { doc: '#eef3fd', slides: '#fdf1ea', cad: '#e9f6f0', sheet: '#eaf5ee' };

  const homeView = el('div', { class: 'home-view' });
  const recentBox = el('div', { class: 'recent' });
  function buildHome() {
    const wrap = el('div', { class: 'home-wrap' });
    wrap.append(el('h1', { text: 'OfficeStudio' }), el('p', { class: 'sub', text: 'Документы Word, таблицы Excel, презентации PowerPoint и чертежи AutoCAD — в одном окне.' }));
    const ver = el('span');
    window.api.updateGet().then((s) => { ver.textContent = 'Версия ' + s.current; });
    const chk = el('button', { text: 'Проверить обновления' });
    chk.addEventListener('click', () => Updates.check(true));
    wrap.append(el('div', { class: 'home-version' }, [ver, chk]));
    const grid = el('div', { class: 'create-grid' });
    const cards = [
      ['doc', 'Новый документ', 'Текст, таблицы, картинки → .docx'],
      ['slides', 'Новая презентация', 'Слайды, фигуры, показ → .pptx'],
      ['sheet', 'Новая таблица', 'Ячейки, формулы, листы → .xlsx'],
      ['cad', 'Новый чертёж', 'Линии, слои, привязки → .dxf'],
    ];
    for (const [k, t, d] of cards) {
      const c = el('button', { class: 'create-card', html: `<div class="art" style="background:${bgs[k]}">${art(k)}</div><div class="meta"><div class="title">${t}</div><div class="desc">${d}</div></div>` });
      c.addEventListener('click', () => newFile(k));
      grid.append(c);
    }
    wrap.append(grid);
    const openBtn = el('button', { class: 'btn-primary', html: icon('folder', 16) + 'Открыть файл…' });
    openBtn.addEventListener('click', openDialog);
    wrap.append(el('div', { class: 'open-row' }, [openBtn, el('span', { style: { alignSelf: 'center', color: 'var(--muted)', fontSize: '12px' }, text: 'DOCX, XLSX, CSV, PPTX, DWG, DXF, TXT, HTML — или перетащите файл в окно' })]));
    const clear = el('button', { text: 'Очистить' });
    clear.addEventListener('click', async () => { await window.api.clearRecent(); refreshRecent(); });
    wrap.append(el('div', { class: 'section-title' }, [el('span', { text: 'Недавние файлы' }), clear]), recentBox);
    wrap.append(el('div', { class: 'hint-row', html: `<span><kbd>Ctrl</kbd> <kbd>N</kbd> документ</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>N</kbd> презентация</span><span><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>T</kbd> таблица</span><span><kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd> чертёж</span><span><kbd>Ctrl</kbd> <kbd>O</kbd> открыть</span><span><kbd>Ctrl</kbd> <kbd>S</kbd> сохранить</span>` }));
    homeView.append(wrap);
  }
  async function refreshRecent() {
    const list = await window.api.getRecent();
    recentBox.innerHTML = '';
    if (!list.length) { recentBox.append(el('div', { class: 'recent-empty', text: 'Здесь появятся файлы, которые вы открывали или сохраняли.' })); return; }
    for (const r of list) {
      const ext = r.name.split('.').pop().toUpperCase();
      const row = el('div', { class: 'recent-item', html: `<div class="badge" style="background:${KIND[r.kind].hex}">${esc(ext.slice(0, 4))}</div><div style="min-width:0"><div class="n">${esc(r.name)}</div><div class="d">${esc(r.dir)}</div></div>` });
      row.addEventListener('click', () => openPaths([r.path]));
      row.addEventListener('contextmenu', (e) => UI.menu(e.clientX, e.clientY, [
        { label: 'Открыть', icon: 'folder', onClick: () => openPaths([r.path]) },
        { label: 'Показать в папке', icon: 'search', onClick: () => window.api.showInFolder(r.path) },
      ]));
      recentBox.append(row);
    }
  }

  // ---------------------------------------------------------------- commands
  async function onMenu(cmd) {
    const ed = active && active.editor;
    switch (cmd) {
      case 'new-doc': return newFile('doc');
      case 'new-slides': return newFile('slides');
      case 'new-cad': return newFile('cad');
      case 'new-sheet': return newFile('sheet');
      case 'open': return openDialog();
      case 'save': return save(active, false);
      case 'save-as': return save(active, true);
      case 'export': return exportActive();
      case 'close-tab': return closeTab(active);
      case 'undo': if (ed && ed.undo) ed.undo(); else document.execCommand('undo'); return;
      case 'redo': if (ed && ed.redo) ed.redo(); else document.execCommand('redo'); return;
      case 'find': if (ed && ed.find) ed.find(); return;
      case 'next-tab': return activate(tabs[(tabs.indexOf(active) + 1) % tabs.length]);
      case 'prev-tab': return activate(tabs[(tabs.indexOf(active) - 1 + tabs.length) % tabs.length]);
      case 'shortcuts': return showShortcuts();
      case 'app-close-request': {
        if (!(await closeAllDirty())) return;
        window.api.forceClose();
        return;
      }
      case 'check-updates': return Updates.check(true);
    }
  }
  async function closeAllDirty() {
    for (const t of [...tabs]) if (t.dirty && !(await closeTab(t))) return false;
    return true;
  }

  // ---------------------------------------------------------------- updates
  const Updates = (() => {
    const b = document.getElementById('update-btn');
    let st = { state: 'idle' };
    let manual = false;
    const dl = icon('download', 15);
    function render() {
      b.classList.remove('busy');
      b.hidden = false;
      switch (st.state) {
        case 'available':
          b.innerHTML = `${dl}<span>Обновить до ${esc(st.version)}</span>`;
          b.title = 'Вышла новая версия OfficeStudio — нажмите, чтобы скачать и установить';
          break;
        case 'downloading':
          b.classList.add('busy');
          b.innerHTML = `<span>Скачиваю ${st.percent || 0}%</span><span class="bar"><i style="width:${st.percent || 0}%"></i></span>`;
          b.title = 'Обновление скачивается, можно продолжать работать';
          break;
        case 'ready':
          b.innerHTML = `${icon('rotate', 15)}<span>Перезапустить и обновить</span>`;
          b.title = `Версия ${st.version} скачана. Открытые файлы будут предложено сохранить.`;
          break;
        case 'checking':
          if (manual) { b.classList.add('busy'); b.innerHTML = '<span>Проверяю обновления…</span>'; } else b.hidden = true;
          break;
        default:
          b.hidden = true;
      }
    }
    window.api.onUpdateState((s) => {
      const prev = st.state;
      st = s;
      render();
      if (manual && s.state === 'none') { manual = false; toast(`У вас последняя версия — ${s.current}`); }
      if (manual && s.state === 'unconfigured') { manual = false; toast('Обновления ещё не настроены в этой сборке', 'error', 6000); }
      if (s.state === 'error' && (manual || prev === 'downloading')) { manual = false; toast('Обновление: ' + s.error, 'error', 7000); }
      if (s.state === 'ready' && prev === 'downloading') toast(`Версия ${s.version} готова. Нажмите «Перезапустить и обновить», когда будет удобно.`, null, 7000);
      if (s.state === 'available' || s.state === 'ready') manual = false;
    });
    b.addEventListener('click', async () => {
      if (st.state === 'available') {
        const notes = st.notes ? el('div', { class: 'upd-notes', text: st.notes }) : null;
        const ok = await modal({ title: `Новая версия ${st.version}`, body: el('div', {}, [el('p', { text: `Сейчас у вас ${st.current}. Обновление скачается в фоне — работать можно, не дожидаясь.` }), notes].filter(Boolean)), okText: 'Скачать и установить' });
        if (ok) window.api.updateDownload();
      } else if (st.state === 'ready') {
        if (!(await closeAllDirty())) return;
        window.api.updateInstall();
      }
    });
    window.api.updateGet().then((s) => { st = s; render(); });
    return {
      check(isManual) { manual = !!isManual; if (manual) { st = { ...st, state: 'checking' }; render(); } window.api.updateCheck(); },
      get state() { return st; },
    };
  })();

  function showShortcuts() {
    const rows = [
      ['Создать документ / презентацию / таблицу / чертёж', 'Ctrl+N / Ctrl+Shift+N / Ctrl+Alt+T / Ctrl+Alt+N'], ['Открыть / Сохранить / Сохранить как', 'Ctrl+O / Ctrl+S / Ctrl+Shift+S'],
      ['Экспорт (PDF, PNG)', 'Ctrl+E'], ['Отменить / Повторить', 'Ctrl+Z / Ctrl+Y'], ['Найти и заменить (документ)', 'Ctrl+F'],
      ['Таблица: редактировать ячейку / перенос строки', 'F2 / Alt+Enter'], ['Таблица: автосумма / абсолютная ссылка', 'Alt+= / F4'], ['Таблица: к краю данных', 'Ctrl+стрелки'],
      ['Презентация: показ слайдов', 'F5'], ['Презентация: дублировать объект', 'Ctrl+D'], ['Презентация: сдвиг объекта', 'Стрелки (Shift — крупно)'],
      ['Чертёж: линия / полилиния / окружность', 'L / P / C'], ['Чертёж: прямоугольник / дуга / текст', 'R / A / T'], ['Чертёж: переместить / копировать', 'M / CO'],
      ['Чертёж: показать всё', 'Z или двойной клик колесом'], ['Чертёж: привязка / сетка / орто', 'F3 / F9 / F8'], ['Чертёж: завершить / отменить команду', 'Enter / Esc'],
    ];
    const tbl = el('table', { class: 'keys', html: rows.map(([a, b]) => `<tr><td>${a}</td><td><kbd>${b}</kbd></td></tr>`).join('') });
    modal({ title: 'Горячие клавиши', body: tbl, cancelText: null, okText: 'Понятно' });
  }

  // ---------------------------------------------------------------- drag & drop
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    dragDepth = 0;
    document.body.classList.remove('dragging');
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    const docFiles = files.filter((f) => /\.(docx|pptx|xlsx|xlsm|csv|xls|dwg|dxf|txt|html?|md|doc|ppt)$/i.test(f.name));
    if (!docFiles.length) return; // let editors handle dropped images
    e.preventDefault();
    e.stopPropagation();
    openPaths(docFiles.map((f) => window.api.pathForFile(f)));
  }, true);

  // ---------------------------------------------------------------- boot
  buildHome();
  addTab({ home: true, view: homeView });
  document.getElementById('tab-new').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    UI.menu(r.left, r.bottom + 4, [
      { label: 'Документ', icon: 'fileText', key: 'Ctrl+N', onClick: () => newFile('doc') },
      { label: 'Презентация', icon: 'presentation', key: 'Ctrl+Shift+N', onClick: () => newFile('slides') },
      { label: 'Таблица', icon: 'table', key: 'Ctrl+Alt+T', onClick: () => newFile('sheet') },
      { label: 'Чертёж', icon: 'ruler', key: 'Ctrl+Alt+N', onClick: () => newFile('cad') },
      '-',
      { label: 'Открыть…', icon: 'folder', key: 'Ctrl+O', onClick: openDialog },
    ]);
  });
  window.api.onMenu(onMenu);
  window.api.onOpenPath((p) => openPaths([p]));
  window.api.takePending().then((p) => p.length && openPaths(p));
  window.App = { openPaths, newFile, save, tabs: () => tabs, active: () => active, updates: () => Updates };
})();
