use std::fs;
use wfs_lib::{api::{ApiIndex, Notes}, diag::{Confidence, Evidence, Severity}, project};

fn run(files: &[(&str, &str)]) -> project::Report {
    let d = tempfile::tempdir().unwrap();
    let root = d.path().join("Bad");
    fs::create_dir_all(&root).unwrap();
    for (p, c) in files {
        let f = root.join(p);
        fs::create_dir_all(f.parent().unwrap()).unwrap();
        fs::write(f, c).unwrap();
    }
    let root = root.canonicalize().unwrap();
    project::validate(&root, &ApiIndex::bundled(), &Notes::bundled())
}
fn has<'a>(r: &'a project::Report, code: &str) -> Vec<&'a wfs_lib::diag::Diagnostic> { r.diagnostics.iter().filter(|d| d.code == code).collect() }

#[test]
fn example_addon_is_clean() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/HelloForever").canonicalize().unwrap();
    let r = project::validate(&root, &ApiIndex::bundled(), &Notes::bundled());
    let bad: Vec<_> = r.diagnostics.iter().filter(|d| matches!(d.severity, Severity::Error | Severity::Warning)).map(|d| format!("{} {}", d.code, d.message)).collect();
    assert!(bad.is_empty(), "example addon should have no errors or warnings: {bad:?}");
    assert_eq!(r.stats.loaded_files, 1);
}

#[test]
fn reports_toc_problems_certainly() {
    let r = run(&[("Bad.toc", "## Interface: 15000\nCore.lua\ncore.lua\nMissing.lua\nsub\\Thing.lua\n"), ("Core.lua", "return 1"), ("Sub/Thing.lua", "return 2")]);
    assert_eq!(has(&r, "toc.missing-file").len(), 1);
    assert!(has(&r, "toc.missing-file")[0].confidence == Confidence::Certain);
    assert_eq!(has(&r, "toc.duplicate-entry").len(), 1);
    assert_eq!(has(&r, "toc.case-mismatch").len(), 2, "core.lua and sub\\Thing.lua both differ in case");
    assert_eq!(has(&r, "toc.no-forever-interface").len(), 1);
}

#[test]
fn api_findings_are_labelled_not_overclaimed() {
    let src = "local f = CreateFrame('Frame')\nf:RegisterEvent('TOTALLY_FAKE_EVENT')\nC_Spell.NotARealFunction(1)\nlocal n = GetItemInfo(6948)\nReloadUI()\nMysteryLib()\nC_Spell.GetSpellInfo(1)\n";
    let r = run(&[("Bad.toc", "## Interface: 16001\nCore.lua\n"), ("Core.lua", src)]);
    let ev = has(&r, "api.unknown-event");
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0].confidence, Confidence::SnapshotAbsence, "absence from the snapshot is not proof");
    assert_eq!(ev[0].evidence, Evidence::NeedsGameTest);
    assert_eq!(has(&r, "api.unknown-namespace-function").len(), 1);
    let removed = has(&r, "api.removed-global");
    assert_eq!(removed.len(), 1, "GetItemInfo is a sourced, measured absence");
    assert_eq!(removed[0].confidence, Confidence::Sourced);
    assert_eq!(has(&r, "wow.protected-reloadui").len(), 1);
    let unk = has(&r, "api.unknown-global");
    assert_eq!(unk.len(), 1);
    assert_eq!(unk[0].severity, Severity::Info, "unknown globals are never errors");
    assert!(r.diagnostics.iter().all(|d| !(d.line == 7 && d.code.starts_with("api."))), "valid API call must not be flagged");
}

#[test]
fn guarded_legacy_calls_are_not_problems() {
    let src = "local function A()\n  if not UnitAura then return end\n  return UnitAura('player', 1)\nend\n";
    let r = run(&[("Bad.toc", "## Interface: 16001\nCore.lua\n"), ("Core.lua", src)]);
    assert!(has(&r, "api.removed-global").is_empty());
    assert_eq!(has(&r, "api.feature-detected").len(), 1);
}

#[test]
fn syntax_errors_and_assets() {
    let r = run(&[("Bad.toc", "## Interface: 16001\nCore.lua\nBroken.lua\n"), ("Core.lua", "local t = 'Interface\\\\AddOns\\\\Bad\\\\media\\\\nope'\nlocal u = 'Interface\\\\AddOns\\\\Bad\\\\media\\\\yes'\n"), ("media/yes.tga", "x"), ("Broken.lua", "local x = = 1\n")]);
    assert_eq!(has(&r, "lua.syntax").len(), 1);
    assert_eq!(has(&r, "lua.syntax")[0].file.as_deref(), Some("Broken.lua"));
    assert_eq!(has(&r, "asset.missing").len(), 1);
}

#[test]
fn xml_includes_are_followed() {
    let r = run(&[("Bad.toc", "## Interface: 16001\nUI.xml\n"), ("UI.xml", "<Ui>\n<Script file=\"a.lua\"/>\n<Include file=\"missing.xml\"/>\n</Ui>"), ("a.lua", "return 1")]);
    assert_eq!(has(&r, "xml.missing-file").len(), 1);
    assert_eq!(r.stats.loaded_files, 1, "a.lua is loaded through XML");
}

#[test]
fn utf8_bom_is_not_a_syntax_error() {
    let r = run(&[("Bad.toc", "\u{feff}## Interface: 16001\nCore.lua\n"), ("Core.lua", "\u{feff}local x = 1\nreturn x\n")]);
    assert!(has(&r, "lua.syntax").is_empty(), "the client tolerates a BOM: {:?}", has(&r, "lua.syntax").iter().map(|d| &d.message).collect::<Vec<_>>());
    assert_eq!(r.stats.loaded_files, 1);
}

#[test]
fn parent_folder_lists_nested_addons() {
    let d = tempfile::tempdir().unwrap();
    for n in ["AddonA", "AddonB"] { fs::create_dir_all(d.path().join(n)).unwrap(); fs::write(d.path().join(n).join(format!("{n}.toc")), "## Interface: 16001\n").unwrap(); }
    fs::create_dir_all(d.path().join("node_modules/x")).unwrap(); fs::write(d.path().join("node_modules/x/x.toc"), "").unwrap();
    let root = d.path().canonicalize().unwrap();
    let info = project::open_info(&root);
    assert!(info.tocs.is_empty());
    assert_eq!(info.nested_addons, vec!["AddonA", "AddonB"]);
}
