//! The browser shell: web `Services`, drag-and-drop, and the eframe web runner.
//!
//! OfficeStudio build (based on DeckCraft v0.11.1, MIT OR Apache-2.0): adds the same
//! `postMessage` bridge to a same-origin parent page (`?host=parent`) that WordCraft, GridCraft
//! and CADCraft have:
//!
//! - `deckcraft:ready` (to the parent): `{ version }`, the app is listening; send a file now.
//! - `deckcraft:open` (from the parent): `{ name, bytes }`, bytes an `ArrayBuffer` or
//!   `Uint8Array`. It opens like a dropped presentation.
//! - `deckcraft:save` (to the parent): `{ name, bytes, saveAs }` for every file DeckCraft would
//!   otherwise download. Save writes PowerPoint (.pptx) rather than the .deckcraft format, and
//!   the presentation then counts as saved.
//! - `deckcraft:dirty` (to the parent): `{ dirty }` whenever unsaved changes appear or go away.
//!
//! Only the parent window on the page's own origin is heard or answered.

use std::cell::RefCell;
use std::rc::Rc;

use deckcraft_engine::Session;
use deckcraft_ui_egui::{Inbox, InboxEvent, InboxFile, Services, SlideApp};
use wasm_bindgen::JsCast as _;
use wasm_bindgen::JsValue;

const PRESENTATION_EXTS: &[&str] = &["deckcraft", "pptx", "potx", "ppsx", "txt", "md"];
const PICTURE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"];
const AUDIO_EXTS: &[&str] = &["wav", "mp3", "m4a", "aac", "flac", "ogg", "opus", "aif", "aiff"];
const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "mov", "webm"];
const CANVAS_ID: &str = "deckcraft_canvas";
const LOADING_ID: &str = "deckcraft_loading";
/// Longest file name taken from the parent page.
const MAX_NAME_CHARS: usize = 255;

type Files = Rc<RefCell<Vec<(String, Vec<u8>)>>>;

/// The parent page, when DeckCraft runs embedded with `?host=parent`.
#[derive(Clone)]
struct Host {
    window: web_sys::Window,
    parent: web_sys::Window,
    origin: String,
    /// Files the parent sent, opened on the next frame.
    incoming: Files,
    /// Files DeckCraft would download, handed to the parent on the next frame.
    outgoing: Files,
}

impl Host {
    fn new() -> Option<Self> {
        let window = web_sys::window()?;
        let parent = window.parent().ok().flatten()?;
        if js_sys::Object::is(&parent, &window) {
            return None;
        }
        let origin = window.location().origin().ok()?;
        Some(Self { window, parent, origin, incoming: Rc::default(), outgoing: Rc::default() })
    }

    fn post(&self, msg: &js_sys::Object, transfer: Option<&JsValue>) {
        let r = match transfer {
            Some(t) => self.parent.post_message_with_transfer(msg, &self.origin, &js_sys::Array::of1(t)),
            None => self.parent.post_message(msg, &self.origin),
        };
        if let Err(e) = r {
            log::warn!("host bridge: postMessage failed: {e:?}");
        }
    }

    fn message(kind: &str) -> js_sys::Object {
        let o = js_sys::Object::new();
        js_sys::Reflect::set(&o, &"type".into(), &format!("deckcraft:{kind}").into()).ok();
        o
    }

    fn ready(&self) {
        let o = Self::message("ready");
        js_sys::Reflect::set(&o, &"version".into(), &env!("CARGO_PKG_VERSION").into()).ok();
        self.post(&o, None);
    }

    fn dirty(&self, dirty: bool) {
        let o = Self::message("dirty");
        js_sys::Reflect::set(&o, &"dirty".into(), &dirty.into()).ok();
        self.post(&o, None);
    }

    fn save(&self, name: &str, bytes: &[u8], save_as: bool) {
        let o = Self::message("save");
        let buf = js_sys::Uint8Array::from(bytes).buffer();
        js_sys::Reflect::set(&o, &"name".into(), &name.into()).ok();
        js_sys::Reflect::set(&o, &"bytes".into(), &buf).ok();
        js_sys::Reflect::set(&o, &"saveAs".into(), &save_as.into()).ok();
        self.post(&o, Some(&buf));
    }

    /// Listen for `deckcraft:open` from the parent window on this origin.
    fn listen(&self, ctx: egui::Context) -> Result<(), String> {
        let incoming = self.incoming.clone();
        let parent = self.parent.clone();
        let origin = self.origin.clone();
        let on_message = wasm_bindgen::closure::Closure::<dyn FnMut(web_sys::MessageEvent)>::new(move |e: web_sys::MessageEvent| {
            if e.origin() != origin {
                return;
            }
            let from_parent = e.source().map(|s| js_sys::Object::is(&s, &parent)).unwrap_or(false);
            if !from_parent {
                return;
            }
            let data = e.data();
            let kind = js_sys::Reflect::get(&data, &"type".into()).ok().and_then(|v| v.as_string()).unwrap_or_default();
            if kind != "deckcraft:open" {
                return;
            }
            let name: String = js_sys::Reflect::get(&data, &"name".into())
                .ok()
                .and_then(|v| v.as_string())
                .unwrap_or_else(|| "presentation.pptx".into())
                .chars()
                .take(MAX_NAME_CHARS)
                .collect();
            let Ok(raw) = js_sys::Reflect::get(&data, &"bytes".into()) else { return };
            let bytes = if raw.is_instance_of::<js_sys::ArrayBuffer>() {
                js_sys::Uint8Array::new(&raw).to_vec()
            } else if raw.is_instance_of::<js_sys::Uint8Array>() {
                js_sys::Uint8Array::from(raw).to_vec()
            } else {
                return;
            };
            incoming.borrow_mut().push((name, bytes));
            ctx.request_repaint();
        });
        self.window.add_event_listener_with_callback("message", on_message.as_ref().unchecked_ref()).map_err(|e| format!("{e:?}"))?;
        on_message.forget();
        Ok(())
    }
}

/// Start the browser shell: install logging, locate the canvas, launch the eframe runner,
/// build the sample or blank deck, and replace the loading element when launch finishes.
pub fn start() {
    eframe::WebLogger::init(log::LevelFilter::Info).ok();
    wasm_bindgen_futures::spawn_local(async {
        let Some(document) = web_sys::window().and_then(|w| w.document()) else {
            log::error!("no document");
            return;
        };
        let Some(canvas) = document.get_element_by_id(CANVAS_ID).and_then(|e| e.dyn_into::<web_sys::HtmlCanvasElement>().ok()) else {
            log::error!("missing <canvas id=\"{CANVAS_ID}\">");
            return;
        };
        let mut options = eframe::WebOptions::default();
        if query().contains("webgl")
            && let eframe::egui_wgpu::WgpuSetup::CreateNew(create) = &mut options.wgpu_options.wgpu_setup
        {
            create.instance_descriptor.backends = eframe::wgpu::Backends::GL;
        }
        let host = if query().contains("host=parent") { Host::new() } else { None };
        let result = eframe::WebRunner::new()
            .start(
                canvas,
                options,
                Box::new(move |cc| {
                    if let Some(rs) = &cc.wgpu_render_state {
                        log::info!("deckcraft-web {}: wgpu backend {:?}", env!("CARGO_PKG_VERSION"), rs.adapter.get_info().backend);
                    }
                    let inbox: Inbox = Inbox::default();
                    let mut app = SlideApp::new(Session::new(), services(inbox.clone(), cc.egui_ctx.clone(), host.as_ref().map(|h| h.outgoing.clone())));
                    let q = query();
                    if !q.contains("blank") && host.is_none() {
                        if let Err(e) = deckcraft_engine::sample::open_sample(&mut app.session) {
                            log::error!("sample deck: {e}");
                        }
                    } else if let Err(e) = app.run("file.new", serde_json::json!({})) {
                        log::error!("new presentation: {e}");
                    }
                    if q.contains("show") {
                        app.start_show(0, false);
                    }
                    if let Some(h) = &host {
                        if let Err(e) = h.listen(cc.egui_ctx.clone()) {
                            log::error!("host bridge: {e}");
                        }
                        h.ready();
                    }
                    Ok(Box::new(WebShell { app, inbox, host, last_dirty: None, source_ext: None }))
                }),
            )
            .await;
        if let Some(el) = document.get_element_by_id(LOADING_ID) {
            match result {
                Ok(()) => el.remove(),
                Err(e) => el.set_inner_html(&format!("<p>DeckCraft failed to start: {e:?}</p><p>A browser with WebGPU or WebGL2 is required.</p>")),
            }
        }
    });
}

fn query() -> String {
    web_sys::window().and_then(|w| w.location().search().ok()).unwrap_or_default()
}

/// Wraps the app to read dropped files asynchronously (browsers can't read them synchronously)
/// and feed them through the inbox.
struct WebShell {
    app: SlideApp,
    inbox: Inbox,
    host: Option<Host>,
    last_dirty: Option<bool>,
    /// The format of the file the parent opened (`pptx`, `potx`…): Save writes it back in it.
    source_ext: Option<String>,
}

impl WebShell {
    /// Files from and to the parent page, and the unsaved-changes state.
    fn host_pass(&mut self) {
        let Some(host) = self.host.clone() else { return };
        let incoming = std::mem::take(&mut *host.incoming.borrow_mut());
        for (name, bytes) in incoming {
            let ext = name.rsplit('.').next().map(str::to_ascii_lowercase).unwrap_or_default();
            self.source_ext = Some(ext);
            // the blank presentation made at start goes away when a file replaces it untouched
            let blank = self.app.session.documents().len() == 1 && self.app.session.active().is_some_and(|d| d.path.is_none() && !d.is_dirty());
            self.app.open_or_insert_bytes(&name, &bytes);
            if blank && self.app.session.documents().len() > 1 {
                self.app.session.set_active(0);
                if let Err(e) = self.app.run("file.close", serde_json::json!({})) {
                    log::warn!("closing the blank presentation: {e}");
                }
                let last = self.app.session.documents().len().saturating_sub(1);
                self.app.session.set_active(last);
            }
            if let Some(d) = self.app.session.active_mut() {
                d.saved_doc = d.doc.clone();
            }
        }
        let outgoing = std::mem::take(&mut *host.outgoing.borrow_mut());
        for (name, bytes) in outgoing {
            let ext = name.rsplit('.').next().map(str::to_ascii_lowercase).unwrap_or_default();
            if ext == "deckcraft" {
                // Save: write the presentation as PowerPoint (or the template/show it came from)
                let fmt = match self.source_ext.as_deref() {
                    Some(f @ ("potx" | "ppsx")) => f.to_string(),
                    Some("deckcraft") => "deckcraft".to_string(),
                    _ => "pptx".to_string(),
                };
                let stem = name.strip_suffix(".deckcraft").unwrap_or(&name).to_string();
                let out = match self.app.session.active() {
                    Some(d) if fmt != "deckcraft" => deckcraft_engine::cmd::file::save_bytes(&d.doc, &fmt).map(|b| (format!("{stem}.{fmt}"), b)),
                    _ => Ok((name.clone(), bytes.clone())),
                };
                match out {
                    Ok((n, b)) => {
                        host.save(&n, &b, false);
                        if let Some(d) = self.app.session.active_mut() {
                            d.saved_doc = d.doc.clone();
                        }
                    }
                    Err(e) => self.app.set_status(e.to_string()),
                }
            } else {
                host.save(&name, &bytes, true);
            }
        }
        let dirty = self.app.session.documents().iter().any(|d| d.is_dirty());
        if self.last_dirty != Some(dirty) {
            self.last_dirty = Some(dirty);
            host.dirty(dirty);
        }
    }
}

impl eframe::App for WebShell {
    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.host_pass();
        let dropped = ctx.input_mut(|i| std::mem::take(&mut i.raw.dropped_files));
        for f in dropped {
            // Capture the document and slide now. The bytes arrive later, after the user may
            // have switched slides.
            let id = self.app.begin_external_file("drop");
            let inbox = self.inbox.clone();
            let ctx = ctx.clone();
            wasm_bindgen_futures::spawn_local(async move {
                let name = f.path().file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "dropped".into());
                match f.bytes_async().await {
                    Ok(bytes) => {
                        push_inbox(&inbox, InboxEvent::File(InboxFile { id, name, bytes }));
                        ctx.request_repaint();
                    }
                    Err(e) => {
                        log::error!("couldn't read dropped file {name}: {e}");
                        push_inbox(&inbox, InboxEvent::Cancelled { id });
                        ctx.request_repaint();
                    }
                }
            });
        }
        self.app.logic(ctx);
        self.host_pass();
    }

    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw: &mut egui::RawInput) {
        self.app.raw_input_hook(raw);
    }

    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        self.app.ui(ui);
    }
}

/// Web services: no file paths, so `pick_open`/`pick_save`/`read` stay `None` and the UI falls
/// back to `open_async` (browser picker → inbox) and `download`. Embedded, downloads go to the
/// parent page instead.
fn services(inbox: Inbox, ctx: egui::Context, outgoing: Option<Files>) -> Services {
    let open_inbox = inbox.clone();
    let out_write = outgoing.clone();
    let out_dl = outgoing;
    let repaint = ctx.clone();
    Services {
        open_async: Some(Box::new(move |purpose: &str, request: u64| {
            let inbox = open_inbox.clone();
            let ctx = ctx.clone();
            let dialog = match purpose {
                "picture" => rfd::AsyncFileDialog::new().add_filter("Pictures", PICTURE_EXTS),
                "audio" => rfd::AsyncFileDialog::new().add_filter("Audio", AUDIO_EXTS),
                "video" => rfd::AsyncFileDialog::new().add_filter("Video", VIDEO_EXTS),
                _ => rfd::AsyncFileDialog::new().add_filter("Presentations", PRESENTATION_EXTS),
            };
            wasm_bindgen_futures::spawn_local(async move {
                let Some(file) = dialog.pick_file().await else {
                    push_inbox(&inbox, InboxEvent::Cancelled { id: request });
                    ctx.request_repaint();
                    return;
                };
                let bytes = file.read().await;
                push_inbox(&inbox, InboxEvent::File(InboxFile { id: request, name: file.file_name(), bytes }));
                ctx.request_repaint();
            });
        })),
        write: Some(Box::new(move |name: &str, bytes: &[u8]| match &out_write {
            Some(out) => {
                out.borrow_mut().push((file_name(name), bytes.to_vec()));
                Ok(())
            }
            None => download(name, bytes),
        })),
        download: Some(Box::new(move |name: &str, bytes: &[u8]| match &out_dl {
            Some(out) => {
                out.borrow_mut().push((file_name(name), bytes.to_vec()));
                repaint.request_repaint();
            }
            None => {
                if let Err(e) = download(name, bytes) {
                    log::error!("download of {name} failed: {e}");
                }
            }
        })),
        inbox: Some(inbox),
        ..Default::default()
    }
}

fn file_name(path: &str) -> String {
    std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "deckcraft".into())
}

fn push_inbox(inbox: &Inbox, event: InboxEvent) {
    inbox.lock().unwrap_or_else(|e| e.into_inner()).push(event);
}

/// Trigger a browser download of `bytes` named after the last component of `path`.
fn download(path: &str, bytes: &[u8]) -> Result<(), String> {
    let js = |e: wasm_bindgen::JsValue| format!("{e:?}");
    let name = file_name(path);
    let window = web_sys::window().ok_or("no window")?;
    let document = window.document().ok_or("no document")?;
    let parts = js_sys::Array::of1(&js_sys::Uint8Array::from(bytes));
    let opts = web_sys::BlobPropertyBag::new();
    opts.set_type(mime_for(&name));
    let blob = web_sys::Blob::new_with_u8_array_sequence_and_options(&parts, &opts).map_err(js)?;
    let url = web_sys::Url::create_object_url_with_blob(&blob).map_err(js)?;
    let a: web_sys::HtmlAnchorElement = document.create_element("a").map_err(js)?.dyn_into().map_err(|_| "not an anchor")?;
    a.set_href(&url);
    a.set_download(&name);
    a.style().set_property("display", "none").map_err(js)?;
    let body = document.body().ok_or("no body")?;
    body.append_child(&a).map_err(js)?;
    a.click();
    a.remove();
    // Revoke after the click has been dispatched; the download keeps its own reference.
    let revoke = wasm_bindgen::closure::Closure::once_into_js(move || {
        web_sys::Url::revoke_object_url(&url).ok();
    });
    window.set_timeout_with_callback_and_timeout_and_arguments_0(revoke.unchecked_ref(), 10_000).map_err(js)?;
    Ok(())
}

fn mime_for(name: &str) -> &'static str {
    match name.rsplit('.').next().map(str::to_ascii_lowercase).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("pdf") => "application/pdf",
        Some("gif") => "image/gif",
        Some("txt") => "text/plain",
        Some("pptx") => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        Some("deckcraft") => "application/zip",
        _ => "application/octet-stream",
    }
}
