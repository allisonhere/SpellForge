//! Integration test against a real addon checkout. Set TEMPUS_DIR to run; skipped otherwise.
//! Read-only: asserts the source tree is unchanged by validation and packaging.
use wfs_lib::{api::{ApiIndex, Notes}, distribute, project};

fn snapshot(root: &std::path::Path) -> Vec<(String, u64)> {
    project::list_files(root).into_iter().map(|f| (f.path, f.size)).collect()
}

#[test]
fn validates_tempus() {
    let Ok(dir) = std::env::var("TEMPUS_DIR") else { eprintln!("TEMPUS_DIR not set; skipping"); return };
    let root = std::path::Path::new(&dir).canonicalize().unwrap();
    let before = snapshot(&root);
    let info = project::open_info(&root);
    assert_eq!(info.main_toc.as_deref(), Some("Tempus.toc"));
    assert_eq!(info.tocs[0].interface, vec![16001, 11508]);
    assert!(info.tocs[0].entries.len() > 70);
    let rep = project::validate(&root, &ApiIndex::bundled(), &Notes::bundled());
    let mut by: std::collections::BTreeMap<String, usize> = Default::default();
    for d in &rep.diagnostics { *by.entry(d.code.clone()).or_default() += 1; }
    eprintln!("stats: {:?}\ncodes: {:#?}", rep.stats, by);
    for d in rep.diagnostics.iter().filter(|d| std::env::var("SHOW").map(|s| d.code.contains(&s)).unwrap_or(false)).take(60) {
        eprintln!("{:?} {} {}:{} {}", d.severity, d.code, d.file.clone().unwrap_or_default(), d.line, d.message);
    }
    assert!(rep.stats.lua_files > 100);
    assert!(!rep.diagnostics.iter().any(|d| d.code == "toc.missing-file"), "Tempus TOC should resolve fully");
    let out = tempfile::tempdir().unwrap();
    let r = distribute::package(&root, &info.addon_name, &out.path().join("Tempus.zip")).unwrap();
    eprintln!("package: {} files, {} bytes", r.files, r.bytes);
    assert_eq!(before, snapshot(&root), "source tree must be unchanged");
}
