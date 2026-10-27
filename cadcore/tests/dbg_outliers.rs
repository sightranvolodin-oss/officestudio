use cadcore::engine::Drawing;
#[test]
fn outliers() {
    let Ok(f) = std::env::var("CAD_FILE") else { return };
    let d = Drawing::from_dxf(&std::fs::read(f).unwrap()).unwrap();
    let lim = 200000.0;
    for (i, b) in d.bbs.iter().enumerate() {
        if let (Some(b), Some(e)) = (b, &d.ents[i]) {
            if b.x1.abs() > lim || b.x2.abs() > lim || b.y1.abs() > lim || b.y2.abs() > lim {
                let j = serde_json::to_string(&e.geo).unwrap();
                println!("{i} layer={} bb=({:.0},{:.0})-({:.0},{:.0}) {}", d.layers.list[e.layer as usize].name, b.x1, b.y1, b.x2, b.y2, &j[..j.len().min(400)]);
            }
        }
    }
}
#[test]
fn view_ext() {
    let Ok(f) = std::env::var("CAD_FILE") else { return };
    let d = Drawing::from_dxf(&std::fs::read(f).unwrap()).unwrap();
    let (b, out) = d.view_extents(true);
    let f = d.extents(true);
    println!("view {:.0},{:.0} - {:.0},{:.0} out={out}; full {:.0},{:.0} - {:.0},{:.0}; origin {:?} tol {}", b.x1, b.y1, b.x2, b.y2, f.x1, f.y1, f.x2, f.y2, (d.origin.x, d.origin.y), d.tol);
}
#[test]
fn big_load() {
    let Ok(f) = std::env::var("CAD_BIG") else { return };
    let t = std::time::Instant::now();
    let bytes = std::fs::read(&f).unwrap();
    let mut d = Drawing::from_dxf(&bytes).unwrap();
    let t1 = t.elapsed();
    drop(bytes);
    d.build_base();
    let hwm = std::fs::read_to_string("/proc/self/status").unwrap().lines().filter(|l| l.starts_with("VmHWM") || l.starts_with("VmRSS")).collect::<Vec<_>>().join(" ");
    println!("parse {:?} total {:?} ents={} blocks={} lines={} tris={} {hwm}", t1, t.elapsed(), d.alive_count(), d.blocks.len(), d.base.total[0], d.base.total[1]);
    let (b, out) = d.view_extents(true);
    println!("view {:.0},{:.0}-{:.0},{:.0} out={out}", b.x1, b.y1, b.x2, b.y2);
}
