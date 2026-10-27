//! Integration tests against real files. Set CAD_SAMPLES to the folder with example_*.dxf and big/big.dxf.
use cadcore::engine::Drawing;

use cadcore::Engine;
use std::time::Instant;

fn samples() -> Option<String> {
    std::env::var("CAD_SAMPLES").ok()
}
fn counts(d: &Drawing) -> std::collections::BTreeMap<String, usize> {
    let mut m = std::collections::BTreeMap::new();
    for e in d.ents.iter().flatten() {
        let t = serde_json::to_value(&e.geo).unwrap()["type"].as_str().unwrap().to_string();
        *m.entry(t).or_insert(0) += 1;
    }
    m
}

#[test]
fn dwg_versions_parse_like_before() {
    let Some(s) = samples() else { return };
    for v in ["r14", "2000", "2004", "2007", "2018"] {
        let bytes = std::fs::read(format!("{s}/samples/example_{v}.dxf")).unwrap();
        let d = Drawing::from_dxf(&bytes).unwrap();
        let c = counts(&d);
        println!("{v}: {} entities {:?} layers={} blocks={} skipped={}", d.alive_count(), c, d.layers.list.len(), d.blocks.len(), d.skipped);
        // the old JS parser saw 52 (it dropped the HATCH); we must see at least those
        assert!(d.alive_count() >= 52, "{v}");
        assert!(c.get("insert").copied().unwrap_or(0) >= 19);
        assert!(c.get("line").copied().unwrap_or(0) >= 8);
        assert!(c.contains_key("hatch"), "hatch should now be supported");
        assert_eq!(d.blocks.len(), 13);
    }
}

#[test]
fn roundtrip_dxf() {
    let Some(s) = samples() else { return };
    let bytes = std::fs::read(format!("{s}/samples/example_2018.dxf")).unwrap();
    let mut e = Engine::new();
    e.load_dxf(&bytes).unwrap();
    let out = e.to_dxf();
    std::fs::write(format!("{s}/rust_rt.dxf"), &out).unwrap();
    let mut e2 = Engine::new();
    e2.load_dxf(&out).unwrap();
    let a = e.extents(false);
    let b = e2.extents(false);
    println!("extents before {:?} after {:?}", a, b);
    for k in 0..4 {
        assert!((a[k] - b[k]).abs() < 1e-3 * (a[2] - a[0]).abs().max(1.0), "extents differ");
    }
    assert!(e2.count() >= e.count());
}

#[test]
fn edits_and_undo_restore_exact_state() {
    let Some(s) = samples() else { return };
    let bytes = std::fs::read(format!("{s}/samples/example_2018.dxf")).unwrap();
    let mut e = Engine::new();
    e.load_dxf(&bytes).unwrap();
    e.build_base();
    let n = e.count();
    let all: Vec<u32> = (0..n).collect();
    let before = e.entities_json(&all);
    let ids = e.add_json(r##"[{"type":"line","layer":"Новый","p1":{"x":0,"y":0},"p2":{"x":10,"y":5}},{"type":"circle","layer":"0","color":"#ff0000","c":{"x":1,"y":1},"r":2}]"##).unwrap();
    assert_eq!(ids.len(), 2);
    assert!(e.layers_json().contains("Новый"));
    // move everything, rotate a copy, mirror, erase, recolour
    e.transform(&all, &[1.0, 0.0, 0.0, 1.0, 100.0, -50.0], false);
    let copies = e.transform(&all[..10], &[0.0, 1.0, -1.0, 0.0, 0.0, 0.0], true);
    assert_eq!(copies.len(), 10);
    e.transform(&all[10..20], &[-1.0, 0.0, 0.0, 1.0, 0.0, 0.0], false);
    e.erase(&all[20..30]);
    e.set_color_of(&all[30..35], "#00ff00");
    e.delete_layer("Tavolo 2");
    e.build_overlay();
    assert!(e.dirty_count() > 0);
    while e.undo() {}
    assert_eq!(e.count(), n);
    assert_eq!(e.entities_json(&all), before, "undo must restore every entity exactly");
    assert!(!e.layers_json().contains("Новый"));
    // redo all, then undo all again
    while e.redo() {}
    assert_ne!(e.entities_json(&all), before, "redo must re-apply the edits");
    while e.undo() {}
    assert_eq!(e.entities_json(&all), before);
}

#[test]
fn big_drawing_performance() {
    let Some(s) = samples() else { return };
    let path = format!("{s}/big/big.dxf");
    let Ok(bytes) = std::fs::read(&path) else { return };
    let t = Instant::now();
    let mut e = Engine::new();
    let st = e.load_dxf(&bytes).unwrap();
    let t_load = t.elapsed();
    let t = Instant::now();
    e.build_base();
    let t_build = t.elapsed();
    let segs = e.base_lines_len() / 4;
    let tris = e.base_tris_len() / 6;
    let ext = e.extents(true);
    let t = Instant::now();
    let mut hits = 0;
    for k in 0..1000 {
        let x = ext[0] + (ext[2] - ext[0]) * ((k * 7919) % 1000) as f64 / 1000.0;
        let y = ext[1] + (ext[3] - ext[1]) * ((k * 104729) % 1000) as f64 / 1000.0;
        if e.pick(x, y, (ext[2] - ext[0]) / 2000.0) >= 0 {
            hits += 1;
        }
    }
    let t_pick = t.elapsed() / 1000;
    let t = Instant::now();
    let sel = e.select_window(ext[0], ext[1], (ext[0] + ext[2]) / 2.0, ext[3], true);
    let t_win = t.elapsed();
    // edit: move 1000 entities, then rebuild only the overlay
    let ids: Vec<u32> = (0..1000).collect();
    let t = Instant::now();
    e.transform(&ids, &[1.0, 0.0, 0.0, 1.0, 5.0, 5.0], false);
    e.build_overlay();
    let hidden = e.take_hidden().len() / 3;
    let t_edit = t.elapsed();
    let t = Instant::now();
    let dxf = e.to_dxf();
    let t_write = t.elapsed();
    let texts = e.texts().len() / 10;
    println!("BIG {st}\n  load {:?}  build {:?}  segments {segs}  triangles {tris}  texts {texts}\n  pick {:?} (hits {hits}/1000)  window {:?} ({} ents)\n  move 1000 + overlay {:?} (hidden ranges {hidden})  write {:?} ({} MB)",
        t_load, t_build, t_pick, t_win, sel.len(), t_edit, t_write, dxf.len() / 1_000_000);
    assert!(texts >= 10000 + 5000, "texts + attributes");
}

#[test]
fn hatch_and_text_details() {
    // solid hatch with a hole; pattern hatch; mtext formatting; \U+ escapes; OCS-mirrored arc
    let dxf = "0\nSECTION\n2\nENTITIES\n\
0\nHATCH\n8\nH\n10\n0\n20\n0\n30\n0\n2\nSOLID\n70\n1\n71\n0\n91\n2\n92\n2\n72\n0\n73\n1\n93\n4\n10\n0\n20\n0\n10\n10\n20\n0\n10\n10\n20\n10\n10\n0\n20\n10\n97\n0\n92\n2\n72\n0\n73\n1\n93\n4\n10\n4\n20\n4\n10\n6\n20\n4\n10\n6\n20\n6\n10\n4\n20\n6\n97\n0\n75\n0\n76\n1\n98\n0\n\
0\nMTEXT\n8\nT\n10\n1\n20\n2\n40\n2.5\n1\n{\\fArial|b1;Привет}\\Pмир \\U+0416\n71\n1\n\
0\nARC\n8\nA\n10\n5\n20\n0\n40\n1\n50\n0\n51\n90\n230\n-1\n\
0\nENDSEC\n0\nEOF\n";
    let mut e = Engine::new();
    e.load_dxf(dxf.as_bytes()).unwrap();
    e.build_base();
    let j = e.entities_json(&[0, 1, 2]);
    println!("{j}");
    assert!(j.contains("\"type\":\"hatch\""));
    assert!(j.contains("Привет\\nмир Ж"));
    // mirrored arc: centre x negated, angles 90..180
    assert!(j.contains("\"c\":{\"x\":-5.0,\"y\":0.0}") && j.contains("\"a0\":90.0") && j.contains("\"a1\":180.0"));
    // hole: 10x10 square minus 2x2 => area 96 → triangles cover 96
    let tris = e.base_tris_len() / 6;
    assert!(tris >= 8, "hatch with hole triangulated ({tris})");
    // picking inside the hole should not hit the hatch, inside the fill should
    assert_eq!(e.pick(8.0, 8.0, 0.01), 0); // fill
    assert_eq!(e.pick(1.0, 1.0, 0.01), 1); // the text box wins over an area fill
    assert_eq!(e.pick(5.0, 5.0, 0.01), -1);
}

#[test]
fn merged_undo_is_one_step() {
    let mut e = Engine::new();
    e.build_base();
    let ids = e.add_json(r#"[{"type":"line","p1":{"x":0,"y":0},"p2":{"x":1,"y":0}},{"type":"line","p1":{"x":0,"y":1},"p2":{"x":1,"y":1}},{"type":"line","p1":{"x":0,"y":2},"p2":{"x":1,"y":2}}]"#).unwrap();
    e.erase(&ids[0..1]);
    e.erase(&ids[1..2]);
    e.erase(&ids[2..3]);
    e.merge_last(3);
    assert_eq!(e.count(), 0);
    assert!(e.undo());
    assert_eq!(e.count(), 3, "one undo restores all three");
    assert!(e.undo());
    assert_eq!(e.count(), 0);
    assert!(e.redo());
    assert!(e.redo());
    assert_eq!(e.count(), 0);
    assert_eq!(e.pick_on_layer(0.5, 0.0, 0.1, "0"), -1);
    e.undo();
    assert_eq!(e.pick_on_layer(0.5, 0.0, 0.1, "0"), ids[0] as i32);
}
