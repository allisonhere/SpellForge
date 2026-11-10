//! Runs against a local Blizzard UI source folder. Set UI_SOURCE_DIR to `<...>/Interface`. Skipped otherwise. Read-only.
use wfs_lib::uisource::{anchors_of, index_dir, resolve, resolve_deep, size_of};

#[test]
fn indexes_blizzard_ui_source() {
    let Ok(dir) = std::env::var("UI_SOURCE_DIR") else { eprintln!("UI_SOURCE_DIR not set; skipping"); return };
    let reg = index_dir(std::path::Path::new(&dir));
    let s = &reg.stats;
    eprintln!("xml files: {}  parse errors: {}  elements: {}  templates: {} (virtual {})  duplicate names: {}", s.xml_files, s.parse_errors.len(), s.elements, s.templates, s.virtual_templates, s.duplicate_names);
    for (f, e) in s.parse_errors.iter().take(8) { eprintln!("  PARSE ERROR {f}: {e}"); }
    let mut tags: Vec<_> = s.tag_counts.iter().collect(); tags.sort_by(|a, b| b.1.cmp(a.1));
    eprintln!("top tags: {:?}", tags.iter().take(12).collect::<Vec<_>>());
    // resolution health over every template
    let (mut resolved, mut with_missing, mut missing_names) = (0usize, 0usize, std::collections::BTreeMap::<String, usize>::new());
    for t in reg.templates.values() {
        if let Some(r) = resolve(&reg, &t.name) { resolved += 1; if !r.missing.is_empty() { with_missing += 1; for m in r.missing { *missing_names.entry(m).or_default() += 1; } } }
    }
    eprintln!("resolved {resolved} templates; {with_missing} reference an undefined base ({} distinct names)", missing_names.len());
    let mut mm: Vec<_> = missing_names.iter().collect(); mm.sort_by(|a, b| b.1.cmp(a.1)); eprintln!("most-missing bases: {:?}", mm.iter().take(8).collect::<Vec<_>>());
    for name in ["UIPanelButtonTemplate", "UIPanelButtonNoTooltipTemplate", "UnitFrameTemplate", "StatusBarTemplate", "UIPanelCloseButton", "BasicFrameTemplate"] {
        match resolve_deep(&reg, name, 6) {
            Some(r) => { let (w, h) = size_of(&r.node); eprintln!("{name}: chain={:?} size=({w:?},{h:?}) anchors={} missing={:?}", r.chain, anchors_of(&r.node).len(), r.missing); }
            None => eprintln!("{name}: not defined"),
        }
    }
    assert!(s.xml_files > 1000, "expected the full interface tree");
    assert!(s.parse_errors.len() * 100 <= s.xml_files, "more than 1% of XML failed to parse");
}

#[test]
fn toc_driven_load_for_forever() {
    use wfs_lib::uisource::{index_load_set, LoadContext};
    let Ok(dir) = std::env::var("UI_SOURCE_DIR") else { return };
    let addons = std::path::Path::new(&dir).join("AddOns");
    // Hypotheses: A = camelot only; B = camelot also satisfies mainline. Family=Mainline is already established.
    for (label, types) in [("A camelot-only", vec!["camelot"]), ("B camelot+mainline", vec!["camelot", "mainline"])] {
        let family = label;
        let ctx = LoadContext { game_types: types.iter().map(|s| s.to_string()).collect(), ..LoadContext::forever() };
        let (reg, st, loaded) = index_load_set(&addons, &ctx);
        let mut bases = std::collections::BTreeSet::new();
        for t in reg.templates.values() { if let Some(r) = resolve(&reg, &t.name) { bases.extend(r.missing); } }
        let strict = label.starts_with('B');
        if strict { assert_eq!(st.missing_toc_files, 0, "every TOC entry should resolve once directives and casing are handled"); assert!(bases.len() <= 3, "Forever's loaded set should resolve almost every inherited template, got {bases:?}"); assert!(loaded.len() > 280); assert_eq!(reg.stats.parse_errors.len(), 0); }
        eprintln!("{family:20} addons={} toc-files={} MISSING-toc-files={} xml-loaded={} includes={} missing-includes={} templates={} dups={} parse-errors={} undefined-bases={} unknown-directives={:?}",
            loaded.len(), st.files_in_toc, st.missing_toc_files, st.xml_loaded, st.includes_followed, st.missing_includes, reg.stats.templates, reg.stats.duplicate_names, reg.stats.parse_errors.len(), bases.len(), st.unknown_directives);
    }
}

#[test]
fn forever_gaps_detail() {
    use wfs_lib::uisource::{index_load_set, LoadContext};
    let Ok(dir) = std::env::var("UI_SOURCE_DIR") else { return };
    let (reg, _st, loaded) = index_load_set(&std::path::Path::new(&dir).join("AddOns"), &LoadContext::forever());
    for a in &loaded { for m in &a.missing { eprintln!("MISSING TOC FILE  {}/{}", a.name, m); } }
    let mut by: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    for t in reg.templates.values() { if let Some(r) = resolve(&reg, &t.name) { for m in r.missing { by.entry(m).or_default().push(t.name.clone()); } } }
    for (m, users) in &by { eprintln!("UNDEFINED BASE {m:45} used by {} e.g. {:?}", users.len(), users.iter().take(2).collect::<Vec<_>>()); }
    // which directives appear, with sample lines
    for (n, t) in reg.templates.iter().filter(|(_, t)| t.file.contains("Camelot/")).take(3) { eprintln!("camelot template sample: {n} in {}", t.file); }
    eprintln!("duplicates now: {}", reg.stats.duplicate_names);
}
