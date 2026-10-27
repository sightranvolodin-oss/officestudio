//! OfficeStudio drawing engine compiled to WebAssembly.
//! The JavaScript editor keeps the UI; geometry, indexing, editing and DXF I/O live here.

pub mod aci;
pub mod dxf;
pub mod edit;
pub mod engine;
pub mod geom;
pub mod model;
pub mod tess;
pub mod writer;

use engine::Drawing;
use geom::{BB, M};
use model::*;
use serde_json::json;
use wasm_bindgen::prelude::*;

fn err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
pub struct Engine {
    d: Drawing,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        Engine { d: Drawing::default() }
    }

    /// Load an ASCII DXF (DWG is converted to DXF before reaching here). Returns a JSON summary.
    pub fn load_dxf(&mut self, bytes: &[u8]) -> Result<String, JsValue> {
        self.d = Drawing::from_dxf(bytes).map_err(err)?;
        Ok(self.stats())
    }

    pub fn stats(&self) -> String {
        json!({ "entities": self.d.alive_count(), "blocks": self.d.blocks.len(), "layers": self.d.layers.list.iter().filter(|l| !l.deleted).count(), "skipped": self.d.skipped, "units": self.d.units }).to_string()
    }

    // ------------------------------------------------------------ layers
    pub fn layers_json(&self) -> String {
        let v: Vec<_> = self.d.layers.list.iter().enumerate().filter(|(_, l)| !l.deleted)
            .map(|(i, l)| json!({ "index": i, "name": l.name, "color": hex(l.color), "visible": l.visible, "alpha": l.alpha })).collect();
        serde_json::to_string(&v).unwrap()
    }
    /// visibility is a view setting (not part of undo history)
    pub fn set_layer_visible(&mut self, name: &str, visible: bool) {
        if let Some(i) = self.d.layers.idx(name) {
            self.d.layers.list[i as usize].visible = visible;
        }
    }
    pub fn set_layer_color(&mut self, name: &str, color: &str) {
        if let (Some(i), Some(c)) = (self.d.layers.idx(name), parse_hex(color)) {
            let mut l = self.d.layers.list.clone();
            l[i as usize].color = c;
            self.d.commit(Vec::new(), Some(l));
        }
    }
    pub fn add_layer(&mut self, name: &str, color: &str) -> bool {
        if name.trim().is_empty() || self.d.layers.idx(name).is_some() {
            return false;
        }
        let saved = self.d.layers.list.clone();
        self.d.layers.get_or_add(name, parse_hex(color).unwrap_or(0xffffff));
        let new = std::mem::replace(&mut self.d.layers.list, saved);
        self.d.layers.rebuild_map();
        self.d.commit(Vec::new(), Some(new));
        true
    }
    pub fn rename_layer(&mut self, old: &str, new: &str) -> bool {
        if new.trim().is_empty() || old == "0" || self.d.layers.idx(new).is_some() {
            return false;
        }
        let Some(i) = self.d.layers.idx(old) else { return false };
        let mut l = self.d.layers.list.clone();
        l[i as usize].name = new.to_string();
        self.d.commit(Vec::new(), Some(l));
        true
    }
    /// delete a layer together with its entities
    pub fn delete_layer(&mut self, name: &str) -> u32 {
        let Some(li) = self.d.layers.idx(name) else { return 0 };
        if li == 0 {
            return 0;
        }
        let ids: Vec<(u32, Option<Ent>)> = self.d.ents.iter().enumerate()
            .filter(|(_, e)| e.as_ref().map(|e| e.layer == li).unwrap_or(false))
            .map(|(i, _)| (i as u32, None)).collect();
        let n = ids.len() as u32;
        let mut l = self.d.layers.list.clone();
        l[li as usize].deleted = true;
        self.d.commit(ids, Some(l));
        n
    }
    /// ids of the live entities on a layer
    pub fn layer_ids(&self, name: &str) -> Vec<u32> {
        match self.d.layers.idx(name) {
            Some(li) => self.d.ents.iter().enumerate().filter_map(|(i, e)| e.as_ref().filter(|e| e.layer == li).map(|_| i as u32)).collect(),
            None => vec![],
        }
    }
    /// [x1, y1, x2, y2] of the entities on a layer (empty if none)
    pub fn layer_extents(&mut self, name: &str) -> Vec<f64> {
        let b = match self.d.layers.idx(name) {
            Some(li) => self.d.layer_extents(li),
            None => return vec![],
        };
        if b.valid() { vec![b.x1, b.y1, b.x2, b.y2] } else { vec![] }
    }
    /// [x1, y1, x2, y2] of the given entities
    pub fn ids_extents(&self, ids: &[u32]) -> Vec<f64> {
        let b = self.d.ids_extents(ids);
        if b.valid() { vec![b.x1, b.y1, b.x2, b.y2] } else { vec![] }
    }
    pub fn layer_count_of(&self, name: &str) -> u32 {
        match self.d.layers.idx(name) {
            Some(li) => self.d.ents.iter().flatten().filter(|e| e.layer == li).count() as u32,
            None => 0,
        }
    }

    // ------------------------------------------------------------ view data
    pub fn extents(&self, visible_only: bool) -> Vec<f64> {
        let b = self.d.extents(visible_only);
        if b.valid() { vec![b.x1, b.y1, b.x2, b.y2] } else { vec![] }
    }
    /// [x1, y1, x2, y2, number of far-away stray objects left out]
    pub fn view_extents(&self, visible_only: bool) -> Vec<f64> {
        let (b, out) = self.d.view_extents(visible_only);
        if b.valid() { vec![b.x1, b.y1, b.x2, b.y2, out as f64] } else { vec![] }
    }
    pub fn origin(&self) -> Vec<f64> {
        vec![self.d.origin.x, self.d.origin.y]
    }
    pub fn build_base(&mut self) {
        self.d.build_base();
    }
    pub fn build_overlay(&mut self) {
        self.d.build_overlay();
    }
    pub fn dirty_count(&self) -> u32 {
        self.d.dirty_count() as u32
    }
    pub fn take_hidden(&mut self) -> Vec<u32> {
        self.d.take_hidden()
    }
    // zero-copy views into wasm memory. groups: [kind, layer, start, count, chunk] per group
    pub fn base_groups(&self) -> Vec<u32> { self.d.base.groups.clone() }
    pub fn base_total(&self, kind: u32) -> u32 { self.d.base.total[(kind & 1) as usize] }
    pub fn base_chunk_pos(&self, i: u32) -> u32 { self.d.base.chunks.get(i as usize).map(|c| c.0.as_ptr() as u32).unwrap_or(0) }
    pub fn base_chunk_col(&self, i: u32) -> u32 { self.d.base.chunks.get(i as usize).map(|c| c.1.as_ptr() as u32).unwrap_or(0) }
    pub fn base_chunk_lay(&self, i: u32) -> u32 { self.d.base.chunks.get(i as usize).map(|c| c.2.as_ptr() as u32).unwrap_or(0) }
    pub fn paper_groups(&self) -> Vec<u32> { self.d.paper.groups.clone() }
    pub fn paper_total(&self, kind: u32) -> u32 { self.d.paper.total[(kind & 1) as usize] }
    pub fn paper_chunk_pos(&self, i: u32) -> u32 { self.d.paper.chunks.get(i as usize).map(|c| c.0.as_ptr() as u32).unwrap_or(0) }
    pub fn paper_chunk_col(&self, i: u32) -> u32 { self.d.paper.chunks.get(i as usize).map(|c| c.1.as_ptr() as u32).unwrap_or(0) }
    pub fn paper_chunk_lay(&self, i: u32) -> u32 { self.d.paper.chunks.get(i as usize).map(|c| c.2.as_ptr() as u32).unwrap_or(0) }
    /// layouts («Лист» tabs): [{name, w, h, vps: [{cx, cy, w, h, mx, my, vh, twist, on}]}]
    pub fn layouts_json(&self) -> String {
        let v: Vec<_> = self.d.layouts.iter().map(|l| json!({ "name": l.name, "w": l.w, "h": l.h, "vps": l.vps, "objects": l.ents.len() })).collect();
        serde_json::to_string(&v).unwrap()
    }
    pub fn build_paper(&mut self, i: u32) { self.d.build_paper(i as usize) }
    pub fn paper_texts(&self) -> Vec<f64> { self.d.paper_texts_flat().0 }
    pub fn paper_texts_str(&self) -> String { self.d.paper_texts_flat().1 }
    pub fn ov_groups(&self) -> Vec<u32> { self.d.overlay.groups.clone() }
    pub fn ov_total(&self, kind: u32) -> u32 { self.d.overlay.total[(kind & 1) as usize] }
    pub fn ov_chunk_pos(&self, i: u32) -> u32 { self.d.overlay.chunks.get(i as usize).map(|c| c.0.as_ptr() as u32).unwrap_or(0) }
    pub fn ov_chunk_col(&self, i: u32) -> u32 { self.d.overlay.chunks.get(i as usize).map(|c| c.1.as_ptr() as u32).unwrap_or(0) }
    pub fn ov_chunk_lay(&self, i: u32) -> u32 { self.d.overlay.chunks.get(i as usize).map(|c| c.2.as_ptr() as u32).unwrap_or(0) }
    /// line segments / triangles in the base buffers (for statistics)
    pub fn base_lines_len(&self) -> u32 { self.d.base.total[0] * 2 }
    pub fn base_tris_len(&self) -> u32 { self.d.base.total[1] * 2 }
    /// selection outline geometry; returns segment count
    pub fn build_sel(&mut self, ids: &[u32], max_segments: u32) -> u32 {
        self.d.build_sel(ids, max_segments as usize) as u32
    }
    pub fn sel_ptr(&self) -> u32 { self.d.sel.as_ptr() as u32 }
    pub fn sel_len(&self) -> u32 { self.d.sel.len() as u32 }
    /// Free the CPU copy of the base buffers after they were uploaded to the GPU
    pub fn release_base(&mut self) {
        let g = std::mem::take(&mut self.d.base.groups);
        let total = self.d.base.total;
        self.d.base = engine::Buffers { groups: g, total, ..Default::default() };
    }

    pub fn texts(&self) -> Vec<f64> {
        self.d.texts_flat().0
    }
    pub fn texts_str(&self) -> String {
        self.d.texts_flat().1
    }
    pub fn layer_segments(&mut self, name: &str) -> Vec<f64> {
        match self.d.layers.idx(name) {
            Some(i) => self.d.layer_segments(i),
            None => vec![],
        }
    }

    // ------------------------------------------------------------ queries
    pub fn pick(&self, x: f64, y: f64, tol: f64) -> i32 {
        self.d.pick(P::new(x, y), tol) as i32
    }
    pub fn select_window(&self, x1: f64, y1: f64, x2: f64, y2: f64, crossing: bool) -> Vec<u32> {
        self.d.select_window(P::new(x1, y1), P::new(x2, y2), crossing)
    }
    pub fn snap(&self, x: f64, y: f64, tol: f64, exclude: &[u32]) -> Vec<f64> {
        match self.d.snap(P::new(x, y), tol, exclude) {
            Some((p, k)) => vec![p.x, p.y, k as f64],
            None => vec![],
        }
    }
    pub fn entity_json(&self, i: u32) -> String {
        match self.d.ents.get(i as usize) {
            Some(Some(e)) => serde_json::to_string(&e.to_json(&self.d.layers)).unwrap(),
            _ => "null".into(),
        }
    }
    pub fn entities_json(&self, ids: &[u32]) -> String {
        let v: Vec<_> = ids.iter().filter_map(|&i| self.d.ents.get(i as usize).and_then(|e| e.as_ref())).map(|e| e.to_json(&self.d.layers)).collect();
        serde_json::to_string(&v).unwrap()
    }
    /// summary of a selection for the properties panel
    pub fn sel_summary(&self, ids: &[u32]) -> String {
        let mut types = std::collections::BTreeSet::new();
        let mut layers = std::collections::BTreeSet::new();
        let mut colors = std::collections::BTreeSet::new();
        let mut n = 0;
        let (mut len, mut area, mut n_area) = (0.0, 0.0, 0);
        for &i in ids {
            if let Some(Some(e)) = self.d.ents.get(i as usize) {
                n += 1;
                if ids.len() <= 200000 {
                    let (l, a) = self.d.measure(e);
                    len += l;
                    if let Some(a) = a { area += a; n_area += 1; }
                }
                let t = serde_json::to_value(&e.geo).ok().and_then(|v| v.get("type").and_then(|t| t.as_str()).map(String::from)).unwrap_or_default();
                types.insert(t);
                layers.insert(self.d.layers.name(e.layer).to_string());
                colors.insert(e.color.map(hex).unwrap_or_default());
            }
        }
        json!({ "count": n, "types": types, "layers": layers, "colors": colors, "length": len, "area": area, "areaCount": n_area }).to_string()
    }
    /// filter ids down to entities that still exist
    pub fn alive(&self, ids: &[u32]) -> Vec<u32> {
        ids.iter().copied().filter(|&i| matches!(self.d.ents.get(i as usize), Some(Some(_)))).collect()
    }
    /// $INSUNITS of the drawing (4 = mm, 6 = m, 0 = not set)
    pub fn units(&self) -> i32 {
        self.d.units as i32
    }
    pub fn count(&self) -> u32 {
        self.d.alive_count() as u32
    }
    pub fn block_names(&self) -> String {
        serde_json::to_string(&self.d.blocks.keys().collect::<Vec<_>>()).unwrap()
    }
    pub fn has_block(&self, name: &str) -> bool {
        self.d.blocks.contains_key(name)
    }

    // ------------------------------------------------------------ edits (all undoable)
    /// add entities from a JSON array; returns their ids
    pub fn add_json(&mut self, json: &str) -> Result<Vec<u32>, JsValue> {
        let list: Vec<EntJson> = serde_json::from_str(json).map_err(err)?;
        let start = self.d.next_id();
        let before = self.d.layers.list.clone();
        let ents: Vec<Ent> = list.into_iter().map(|j| Ent::from_json(j, &mut self.d.layers)).collect();
        let layers_changed = self.d.layers.list.len() != before.len() || self.d.layers.list != before;
        let new_layers = if layers_changed { Some(std::mem::replace(&mut self.d.layers.list, before)) } else { None };
        if layers_changed {
            self.d.layers.rebuild_map();
        }
        let ids: Vec<u32> = (0..ents.len() as u32).map(|k| start + k).collect();
        self.d.commit(ids.iter().copied().zip(ents.into_iter().map(Some)).collect(), new_layers);
        Ok(ids)
    }
    pub fn replace_json(&mut self, i: u32, json: &str) -> Result<(), JsValue> {
        let j: EntJson = serde_json::from_str(json).map_err(err)?;
        let before = self.d.layers.list.clone();
        let e = Ent::from_json(j, &mut self.d.layers);
        let nl = if self.d.layers.list != before { let n = std::mem::replace(&mut self.d.layers.list, before); self.d.layers.rebuild_map(); Some(n) } else { None };
        self.d.commit(vec![(i, Some(e))], nl);
        Ok(())
    }
    pub fn erase(&mut self, ids: &[u32]) {
        let ch: Vec<(u32, Option<Ent>)> = ids.iter().filter(|&&i| matches!(self.d.ents.get(i as usize), Some(Some(_)))).map(|&i| (i, None)).collect();
        if !ch.is_empty() {
            self.d.commit(ch, None);
        }
    }
    pub fn set_layer_of(&mut self, ids: &[u32], layer: &str) {
        let Some(li) = self.d.layers.idx(layer) else { return };
        let ch: Vec<(u32, Option<Ent>)> = ids.iter().filter_map(|&i| self.d.ents.get(i as usize).and_then(|e| e.clone()).map(|mut e| { e.layer = li; (i, Some(e)) })).collect();
        self.d.commit(ch, None);
    }
    /// "" = ByLayer
    pub fn set_color_of(&mut self, ids: &[u32], color: &str) {
        let c = parse_hex(color);
        let ch: Vec<(u32, Option<Ent>)> = ids.iter().filter_map(|&i| self.d.ents.get(i as usize).and_then(|e| e.clone()).map(|mut e| { e.color = c; e.by_block = false; (i, Some(e)) })).collect();
        self.d.commit(ch, None);
    }
    /// apply a similarity transform [a,b,c,d,e,f]; with copy=true new entities are created. Returns resulting ids.
    pub fn transform(&mut self, ids: &[u32], m: &[f64], copy: bool) -> Vec<u32> {
        if m.len() != 6 {
            return vec![];
        }
        let mm = M([m[0], m[1], m[2], m[3], m[4], m[5]]);
        let mut next = self.d.next_id();
        let mut ch = Vec::with_capacity(ids.len());
        let mut out = Vec::with_capacity(ids.len());
        for &i in ids {
            if let Some(Some(e)) = self.d.ents.get(i as usize) {
                let ne = Ent { geo: edit::xform(&e.geo, &mm), ..e.clone() };
                let id = if copy { let k = next; next += 1; k } else { i };
                ch.push((id, Some(ne)));
                out.push(id);
            }
        }
        if !ch.is_empty() {
            self.d.commit(ch, None);
        }
        out
    }
    /// define a block (e.g. a dimension) — blocks are not removed by undo
    pub fn add_block(&mut self, name: &str, base_x: f64, base_y: f64, json: &str) -> Result<(), JsValue> {
        let list: Vec<EntJson> = serde_json::from_str(json).map_err(err)?;
        let ents: Vec<Ent> = list.into_iter().map(|j| Ent::from_json(j, &mut self.d.layers)).collect();
        self.d.blocks.insert(name.to_string(), Block { base: P::new(base_x, base_y), ents });
        Ok(())
    }
    pub fn merge_last(&mut self, n: u32) {
        self.d.merge_last(n as usize);
    }
    /// name of the layer under the cursor, looking inside blocks ("" if nothing)
    pub fn pick_layer(&mut self, x: f64, y: f64, tol: f64) -> String {
        match self.d.pick_layer(P::new(x, y), tol) {
            Some(l) => self.d.layers.name(l).to_string(),
            None => String::new(),
        }
    }
    pub fn pick_on_layer(&self, x: f64, y: f64, tol: f64, layer: &str) -> i32 {
        match self.d.layers.idx(layer) {
            Some(li) => self.d.pick_on_layer(P::new(x, y), tol, li) as i32,
            None => -1,
        }
    }
    pub fn undo(&mut self) -> bool {
        self.d.undo()
    }
    pub fn redo(&mut self) -> bool {
        self.d.redo()
    }

    pub fn to_dxf(&self) -> Vec<u8> {
        writer::write(&self.d)
    }
    pub fn chord_tol(&self) -> f64 {
        self.d.tol
    }
}

impl Default for Engine {
    fn default() -> Self {
        Engine::new()
    }
}

/// expose BB for tests
pub fn _bb() -> BB {
    BB::EMPTY
}
