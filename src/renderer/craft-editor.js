/*
 * The embedded editors: WordCraft (documents), GridCraft (spreadsheets), DeckCraft (presentations)
 * and CADCraft (drawings) — web builds of the ArtCraft «Crafting Apps» (MIT OR Apache-2.0,
 * github.com/storytold), each running in a tab's <iframe> on OfficeStudio's own origin.
 *
 * WordCraft, GridCraft and CADCraft speak a postMessage protocol (`?host=parent`):
 *   <app>:ready → we send <app>:open {name, bytes};  <app>:save {name, bytes, saveAs} → we write
 *   the file;  <app>:dirty {dirty};  <app>:failed {error}.
 * DeckCraft has no such bridge yet: the file is dropped onto its canvas and its downloads (Save,
 * exports) are caught before the browser would save them.
 */
(function () {
  const { el, toast } = UI;
  const APPS = {
    doc: { app: 'wordcraft', docExt: ['docx', 'docm', 'dotx', 'odt', 'rtf', 'doc', 'html', 'htm', 'md', 'txt', 'tex'] },
    sheet: { app: 'gridcraft', docExt: ['xlsx', 'xlsm', 'xltx', 'xlsb', 'ods', 'csv'] },
    slides: { app: 'deckcraft', docExt: ['pptx', 'potx', 'ppsx', 'deckcraft'] },
    cad: { app: 'cadcraft', docExt: ['dxf', 'dwg'] },
  };
  // a new drawing: an empty metric DXF (CADCraft's own «New» starts in inches)
  const EMPTY_DXF = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1015', '9', '$INSUNITS', '70', '4', '9', '$MEASUREMENT', '70', '1', '9', '$LUNITS', '70', '2', '9', '$DWGCODEPAGE', '3', 'ANSI_1251', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES', '0', 'ENDSEC', '0', 'EOF', ''].join('\r\n');

  class CraftEditor {
    /**
     * @param view   the tab's element
     * @param data   { bytes?: Uint8Array, sendName?: string }
     * @param opts   { tab, kind, onDirty(v), onFail(reason) }
     */
    constructor(view, data, opts) {
      this.view = view;
      this.tab = opts.tab;
      this.kind = opts.kind;
      this.cfg = APPS[opts.kind];
      this.opts = opts;
      this.pendingSave = null;
      this.ready = false;
      // DeckCraft speaks the bridge in OfficeStudio's own build of it; an upstream build doesn't
      this.bridge = true;
      let bytes = data && data.bytes;
      let name = (data && data.sendName) || '';
      if (!bytes && this.kind === 'cad') { bytes = new TextEncoder().encode(EMPTY_DXF); name = this.tab.name.replace(/\.[^.]+$/, '') + '.dxf'; }
      this.file = bytes ? { name, bytes } : null;
      view.classList.add('craft-view');
      const q = this.cfg.app === 'deckcraft' ? 'host=parent&blank' : 'host=parent';
      this.frame = el('iframe', { class: 'craft-frame', src: `crafts/${this.cfg.app}/index.html?${q}`, allow: 'clipboard-read; clipboard-write; fullscreen; local-fonts', title: this.tab.name });
      this.loading = el('div', { class: 'craft-loading', html: '<div class="spin"></div><div>Загрузка редактора…</div>' });
      view.append(this.frame, this.loading);
      this.onMessage = (e) => this.message(e);
      window.addEventListener('message', this.onMessage);
      this.frame.addEventListener('load', () => this.frameLoaded());
      this.failTimer = setTimeout(() => { if (!this.ready) this.fail('Редактор не запустился за 40 секунд'); }, 40000);
    }

    // ---------------------------------------------------------------- protocol
    get win() { return this.frame.contentWindow; }
    message(e) {
      if (e.source !== this.win || e.origin !== location.origin) return;
      const d = e.data || {};
      const type = String(d.type || '');
      if (!type.startsWith(this.cfg.app + ':')) return;
      switch (type.slice(this.cfg.app.length + 1)) {
        case 'ready':
          this.started();
          if (this.file) {
            const b = this.file.bytes;
            const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
            this.win.postMessage({ type: this.cfg.app + ':open', name: this.file.name, bytes: ab }, location.origin, [ab]);
            this.file = null;
          }
          break;
        case 'save':
          this.saved(d.name, d.bytes, !!d.saveAs);
          break;
        case 'dirty':
          this.opts.onDirty(!!d.dirty);
          break;
        case 'failed':
          this.fail(d.error || 'ошибка запуска');
          break;
      }
    }
    started() {
      if (this.ready) return;
      this.ready = true;
      clearTimeout(this.failTimer);
      this.loading.remove();
      this.focus();
    }
    fail(reason) {
      if (this.failed) return;
      this.failed = true;
      clearTimeout(this.failTimer);
      this.opts.onFail && this.opts.onFail(reason);
    }

    /** DeckCraft: wait for its canvas, drop the file on it, catch its downloads, guess «unsaved» */
    frameLoaded() {
      // Ctrl+/ (pencil marks) also when the keyboard focus is inside the editor
      try { if (window.OS_ANNOT_KEY) this.win.addEventListener('keydown', window.OS_ANNOT_KEY, true); } catch {}
      if (this.cfg.app !== 'deckcraft') return;
      // no `deckcraft:ready` within a few seconds of its canvas appearing: an upstream build
      const waitBridge = (n) => {
        if (this.ready || this.destroyed) return;
        let started = false;
        try { started = !!this.win.document.getElementById('deckcraft_canvas') && !this.win.document.getElementById('deckcraft_loading'); } catch {}
        if (!started || n < 20) return setTimeout(() => waitBridge(started ? n + 1 : n), 300);
        this.bridge = false;
        this.legacyDeck();
      };
      waitBridge(0);
    }
    legacyDeck() {
      const w = this.win;
      if (!w) return;
      const self = this;
      try {
        const click = w.HTMLAnchorElement.prototype.click;
        w.HTMLAnchorElement.prototype.click = function () {
          if (this.download && /^blob:/.test(this.href)) {
            const name = this.download, href = this.href;
            w.fetch(href).then((r) => r.arrayBuffer()).then((ab) => self.saved(name, ab, false)).catch((err) => toast('Не удалось сохранить: ' + err.message, 'error', 7000));
            return;
          }
          return click.call(this);
        };
      } catch (err) { console.warn(err); }
      const d = w.document;
      const edit = () => { if (this.ready) this.opts.onDirty(true); };
      d.addEventListener('keydown', (e) => {
        const k = e.key;
        if (e.ctrlKey || e.metaKey) { if (/^[vxzydbiu]$/i.test(k)) edit(); return; }
        if (k.length === 1 || /^(Backspace|Delete|Enter|Tab|Arrow)/.test(k)) edit();
      }, true);
      let down = null;
      d.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; }, true);
      d.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 3) edit(); down = null; }, true);
      d.addEventListener('drop', edit, true);
      const tryStart = () => {
        if (this.destroyed) return;
        const loadingEl = d.getElementById('deckcraft_loading');
        const canvas = d.getElementById('deckcraft_canvas');
        if (loadingEl && /failed/i.test(loadingEl.textContent)) return this.fail(loadingEl.textContent.trim());
        if (!canvas || loadingEl) return setTimeout(tryStart, 300);
        this.started();
        if (this.file) {
          const dt = new w.DataTransfer();
          dt.items.add(new w.File([this.file.bytes], this.file.name));
          for (const t of ['dragenter', 'dragover', 'drop']) canvas.dispatchEvent(new w.DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
          this.file = null;
          setTimeout(() => this.opts.onDirty(false), 1500);
        }
      };
      tryStart();
    }

    /** a file from the editor: the document itself (Save / Save As) or an export */
    async saved(name, bytes, saveAs) {
      const t = this.tab;
      const ext = String(name || '').split('.').pop().toLowerCase();
      const isDoc = this.cfg.docExt.includes(ext);
      const dir = t.path ? null : t.openedFrom ? t.openedFrom.replace(/[\\/][^\\/]*$/, '') : null;
      const r = await window.api.craftSave({ target: isDoc ? t.path : null, name, bytes: new Uint8Array(bytes), saveAs: isDoc ? saveAs : true, dir });
      const pending = this.pendingSave;
      this.pendingSave = null;
      if (!r.ok) {
        if (!r.canceled) toast('Ошибка сохранения: ' + r.error, 'error', 7000);
        // the editor counts the file as saved once it has handed it over: it is not
        if (isDoc) setTimeout(() => this.opts.onDirty(true), 300);
        if (pending) pending(false);
        return;
      }
      if (isDoc) {
        t.path = r.path;
        t.name = r.name;
        this.opts.onSaved && this.opts.onSaved(r);
        this.opts.onDirty(false);
        if (this.kind === 'cad' && t.sourceExt === '.dwg' && !this.dwgNoted) {
          this.dwgNoted = true;
          toast('Чертёж сохранён в DXF — его открывает AutoCAD и любые CAD-программы (записать DWG может только платный AutoCAD/ODA).', null, 8000);
        } else toast(`Сохранено: ${r.name}`);
      } else toast(`Сохранено: ${r.name}`);
      if (pending) pending(true);
    }

    // ---------------------------------------------------------------- keys from the menu
    canvas() {
      try { return this.frame.contentDocument.querySelector('canvas'); } catch { return null; }
    }
    key(key, { ctrl = false, shift = false, alt = false } = {}) {
      const c = this.canvas();
      if (!c) return false;
      const w = this.win;
      const code = /^[a-z]$/i.test(key) ? 'Key' + key.toUpperCase() : key;
      for (const type of ['keydown', 'keyup']) c.dispatchEvent(new w.KeyboardEvent(type, { key, code, ctrlKey: ctrl, shiftKey: shift, altKey: alt, bubbles: true, cancelable: true }));
      return true;
    }
    focus() {
      try { this.frame.focus(); const c = this.canvas(); if (c) c.focus(); } catch {}
    }

    // ---------------------------------------------------------------- editor API used by the shell
    /** asks the editor to save; resolves true once the file is written */
    save(saveAs) {
      if (!this.ready) return Promise.resolve(false);
      return new Promise((resolve) => {
        const prev = this.pendingSave;
        if (prev) prev(false);
        const timer = setTimeout(() => { if (this.pendingSave === done) { this.pendingSave = null; resolve(false); } }, 120000);
        const done = (ok) => { clearTimeout(timer); resolve(ok); };
        this.pendingSave = done;
        this.key('s', { ctrl: true, shift: !!saveAs });
      });
    }
    undo() { this.key('z', { ctrl: true }); }
    redo() { this.key('y', { ctrl: true }); }
    find() { this.key('f', { ctrl: true }); }
    printPreview() { this.key('p', { ctrl: true }); }
    exportMenu() { toast('Экспорт в PDF и картинки — в меню «Файл» внутри редактора.', null, 5000); this.focus(); }
    onActivate() { setTimeout(() => this.focus(), 0); }
    getData() { return null; }
    destroy() {
      this.destroyed = true;
      clearTimeout(this.failTimer);
      window.removeEventListener('message', this.onMessage);
      try { this.frame.src = 'about:blank'; } catch {}
    }
  }

  window.CraftEditor = CraftEditor;
})();
