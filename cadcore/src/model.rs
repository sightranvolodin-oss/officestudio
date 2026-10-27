//! Drawing data model. Entities are stored with layer indices; the JSON form (used by the
//! JavaScript editor) uses layer names and '#rrggbb' colours.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct P {
    pub x: f64,
    pub y: f64,
}
impl P {
    pub const fn new(x: f64, y: f64) -> P {
        P { x, y }
    }
}

/// Polyline vertex with bulge (tan(sweep/4) of the arc to the next vertex).
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct V {
    pub x: f64,
    pub y: f64,
    #[serde(default)]
    pub b: f64,
}
impl V {
    pub fn p(&self) -> P {
        P::new(self.x, self.y)
    }
}

fn one() -> f64 {
    1.0
}
fn one_u() -> u32 {
    1
}
fn is_zero(v: &f64) -> bool {
    *v == 0.0
}
fn is_one(v: &f64) -> bool {
    *v == 1.0
}
fn is_false(v: &bool) -> bool {
    !*v
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TextData {
    pub p: P,
    pub h: f64,
    pub text: String,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub rot: f64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub halign: f64,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub valign: f64,
    #[serde(default, skip_serializing_if = "is_false")]
    pub mtext: bool,
    /// width factor (TEXT code 41)
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub wf: f64,
    /// MTEXT background mask: 0xRRGGBB, or BG_MASK = "drawing background colour"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<u32>,
    /// mask border offset factor (code 45, 1.0 … 5.0)
    #[serde(default = "one", skip_serializing_if = "is_one")]
    pub mk: f64,
}
pub const BG_MASK: u32 = 0x0100_0000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PatLine {
    /// family direction in degrees
    pub ang: f64,
    pub bx: f64,
    pub by: f64,
    /// offset between successive lines (already rotated/scaled, as stored in DXF)
    pub ox: f64,
    pub oy: f64,
    #[serde(default)]
    pub dashes: Vec<f64>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Geo {
    Line {
        p1: P,
        p2: P,
    },
    Poly {
        pts: Vec<V>,
        #[serde(default)]
        closed: bool,
        #[serde(default, skip_serializing_if = "is_false")]
        filled: bool,
    },
    Circle {
        c: P,
        r: f64,
    },
    /// angles in degrees, counter-clockwise from a0 to a1
    Arc {
        c: P,
        r: f64,
        a0: f64,
        a1: f64,
    },
    /// major = vector from centre to end of major axis; params in radians
    Ellipse {
        c: P,
        major: P,
        ratio: f64,
        t0: f64,
        t1: f64,
    },
    Text(TextData),
    Point {
        p: P,
    },
    Insert {
        block: String,
        p: P,
        #[serde(default = "one")]
        sx: f64,
        #[serde(default = "one")]
        sy: f64,
        #[serde(default)]
        rot: f64,
        #[serde(default = "one_u", skip_serializing_if = "is_one_u")]
        cols: u32,
        #[serde(default = "one_u", skip_serializing_if = "is_one_u")]
        rows: u32,
        #[serde(default, skip_serializing_if = "is_zero")]
        cs: f64,
        #[serde(default, skip_serializing_if = "is_zero")]
        rs: f64,
        /// attribute values, already in world coordinates
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        attribs: Vec<TextData>,
    },
    Hatch {
        loops: Vec<Vec<V>>,
        #[serde(default)]
        solid: bool,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pattern: Vec<PatLine>,
    },
}
fn is_one_u(v: &u32) -> bool {
    *v == 1
}

#[derive(Clone, Debug, PartialEq)]
pub struct Ent {
    pub layer: u32,
    /// explicit 0xRRGGBB colour; None = ByLayer
    pub color: Option<u32>,
    pub by_block: bool,
    /// opacity 1..=255 (DXF 440); None = ByLayer
    pub alpha: Option<u8>,
    pub geo: Geo,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Layer {
    pub name: String,
    pub color: u32,
    pub visible: bool,
    pub deleted: bool,
    /// layer opacity 1..=255 (AcCmTransparency xdata); 255 = opaque
    pub alpha: u8,
}

#[derive(Clone, Debug, Default)]
pub struct Block {
    pub base: P,
    pub ents: Vec<Ent>,
}

/// JSON shape exchanged with JavaScript
#[derive(Serialize, Deserialize)]
pub struct EntJson {
    #[serde(default = "zero_name")]
    pub layer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, rename = "byBlock", skip_serializing_if = "is_false")]
    pub by_block: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alpha: Option<u8>,
    #[serde(flatten)]
    pub geo: Geo,
}
fn zero_name() -> String {
    "0".into()
}

pub fn hex(rgb: u32) -> String {
    format!("#{:06x}", rgb & 0xffffff)
}
pub fn parse_hex(s: &str) -> Option<u32> {
    let s = s.trim().trim_start_matches('#');
    if s.len() == 6 {
        u32::from_str_radix(s, 16).ok()
    } else if s.len() == 3 {
        let v = u32::from_str_radix(s, 16).ok()?;
        let (r, g, b) = ((v >> 8) & 15, (v >> 4) & 15, v & 15);
        Some((r * 17) << 16 | (g * 17) << 8 | b * 17)
    } else {
        None
    }
}

#[derive(Default)]
pub struct Layers {
    pub list: Vec<Layer>,
    pub map: HashMap<String, u32>,
}
impl Layers {
    pub fn get_or_add(&mut self, name: &str, color: u32) -> u32 {
        if let Some(&i) = self.map.get(name) {
            if self.list[i as usize].deleted {
                let l = &mut self.list[i as usize];
                l.deleted = false;
                l.visible = true;
                l.color = color;
            }
            return i;
        }
        let i = self.list.len() as u32;
        self.list.push(Layer { name: name.to_string(), color, visible: true, deleted: false, alpha: 255 });
        self.map.insert(name.to_string(), i);
        i
    }
    pub fn idx(&self, name: &str) -> Option<u32> {
        self.map.get(name).copied().filter(|&i| !self.list[i as usize].deleted)
    }
    pub fn name(&self, i: u32) -> &str {
        self.list.get(i as usize).map(|l| l.name.as_str()).unwrap_or("0")
    }
    pub fn visible(&self, i: u32) -> bool {
        self.list.get(i as usize).map(|l| l.visible && !l.deleted).unwrap_or(true)
    }
    pub fn rebuild_map(&mut self) {
        self.map = self.list.iter().enumerate().map(|(i, l)| (l.name.clone(), i as u32)).collect();
    }
}

impl Ent {
    pub fn to_json(&self, layers: &Layers) -> EntJson {
        EntJson {
            layer: layers.name(self.layer).to_string(),
            color: self.color.map(hex),
            by_block: self.by_block,
            alpha: self.alpha,
            geo: self.geo.clone(),
        }
    }
    pub fn from_json(j: EntJson, layers: &mut Layers) -> Ent {
        let layer = layers.get_or_add(&j.layer, 0xffffff);
        Ent { layer, color: j.color.as_deref().and_then(parse_hex), by_block: j.by_block, alpha: j.alpha, geo: j.geo }
    }
}

/// A paper-space viewport: rectangle on the sheet (paper units) showing part of the model
#[derive(Clone, Debug, Default, Serialize)]
pub struct Viewport {
    pub cx: f64,
    pub cy: f64,
    pub w: f64,
    pub h: f64,
    /// model point shown at the viewport centre
    pub mx: f64,
    pub my: f64,
    /// model height shown in the viewport
    pub vh: f64,
    pub twist: f64,
    pub id: i64,
    pub on: bool,
}

/// A «Лист» tab: sheet size, viewports and paper-space objects (frames, stamps…)
#[derive(Clone, Debug, Default)]
pub struct Layout {
    pub name: String,
    pub order: i64,
    pub block: String,
    pub w: f64,
    pub h: f64,
    pub rot: i64,
    pub vps: Vec<Viewport>,
    pub ents: Vec<Ent>,
}
