use crate::api::{is_lua_builtin, ApiIndex, Notes};
use crate::diag::{Confidence, Diagnostic, Evidence, Severity};
use crate::fsguard::to_rel_string;
use crate::lua::{self, Symbol};
use crate::toc::{parse_toc, Toc};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const SKIP_DIRS: &[&str] = &[".git", "node_modules", ".svn", ".hg", "target"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub root: String,
    pub name: String,
    pub addon_name: String,
    pub tocs: Vec<Toc>,
    pub main_toc: Option<String>,
}

pub fn list_files(root: &Path) -> Vec<FileEntry> {
    let mut out = vec![];
    for e in WalkDir::new(root).follow_links(false).sort_by_file_name().into_iter().filter_entry(|e| {
        e.depth() == 0 || !(e.file_type().is_dir() && SKIP_DIRS.contains(&e.file_name().to_string_lossy().as_ref()))
    }) {
        let Ok(e) = e else { continue };
        if e.depth() == 0 {
            continue;
        }
        let md = e.metadata().ok();
        out.push(FileEntry {
            path: to_rel_string(root, e.path()),
            is_dir: e.file_type().is_dir(),
            size: md.map(|m| m.len()).unwrap_or(0),
            is_symlink: e.path_is_symlink(),
        });
    }
    out
}

fn read_text(p: &Path) -> Option<String> {
    std::fs::read(p).ok().map(|b| String::from_utf8_lossy(&b).into_owned())
}

pub fn load_tocs(root: &Path) -> Vec<Toc> {
    let mut tocs = vec![];
    if let Ok(rd) = std::fs::read_dir(root) {
        let mut names: Vec<_> = rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.to_lowercase().ends_with(".toc")).collect();
        names.sort();
        for n in names {
            if let Some(t) = read_text(&root.join(&n)) {
                tocs.push(parse_toc(&n, &t));
            }
        }
    }
    tocs
}

/// TOC base name without a flavour suffix such as `_Camelot`, `_Mainline`, `-Classic`.
pub fn addon_name_from_toc(file: &str) -> String {
    let stem = file.trim_end_matches(".toc").trim_end_matches(".TOC");
    for suf in ["_Camelot", "_Forever", "_Mainline", "_Vanilla", "_Classic", "_Cata", "_Wrath", "_TBC", "-Mainline", "-Classic"] {
        if let Some(s) = stem.strip_suffix(suf) {
            return s.to_string();
        }
    }
    stem.to_string()
}

pub fn open_info(root: &Path) -> ProjectInfo {
    let tocs = load_tocs(root);
    let folder = root.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let main = tocs.iter().find(|t| addon_name_from_toc(&t.file) == folder && !t.file.contains('_')).or_else(|| tocs.iter().min_by_key(|t| t.file.len())).map(|t| t.file.clone());
    let addon_name = main.as_deref().map(addon_name_from_toc).unwrap_or_else(|| folder.clone());
    ProjectInfo { root: root.display().to_string(), name: folder, addon_name, tocs, main_toc: main }
}

/// Find the on-disk case-exact name of `rel` under root, case-insensitively. Returns (exists_exact, actual_if_case_differs).
fn lookup_ci(root: &Path, rel: &str) -> (bool, Option<String>) {
    let mut cur = root.to_path_buf();
    let mut exact = true;
    let mut actual = vec![];
    for part in rel.split('/').filter(|s| !s.is_empty()) {
        let direct = cur.join(part);
        if direct.symlink_metadata().is_ok() {
            actual.push(part.to_string());
            cur = direct;
            continue;
        }
        let found = std::fs::read_dir(&cur).ok().and_then(|rd| rd.filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().into_owned()).find(|n| n.eq_ignore_ascii_case(part)));
        match found {
            Some(n) => {
                exact = false;
                cur = cur.join(&n);
                actual.push(n);
            }
            None => return (false, None),
        }
    }
    if exact { (true, None) } else { (true, Some(actual.join("/"))) }
}

fn xml_file_refs(xml: &str) -> Vec<(String, &'static str, u32)> {
    // (path, tag kind, line). Lexical scan for Script/Include/Texture/Font file attributes.
    let mut out = vec![];
    for (i, line) in xml.lines().enumerate() {
        let lower = line.to_ascii_lowercase();
        for (tag, kind) in [("<script", "script"), ("<include", "include"), ("<texture", "asset"), ("<font ", "asset"), ("<fontstring", "asset")] {
            let mut from = 0;
            while let Some(p) = lower[from..].find(tag) {
                let start = from + p;
                let end = lower[start..].find('>').map(|e| start + e).unwrap_or(lower.len());
                let seg = &line[start..end];
                for attr in ["file=\"", "font=\"", "file='"] {
                    if let Some(a) = seg.to_ascii_lowercase().find(attr) {
                        let v = &seg[a + attr.len()..];
                        if let Some(q) = v.find(['"', '\'']) {
                            out.push((v[..q].to_string(), kind, i as u32 + 1));
                        }
                    }
                }
                from = end.max(start + 1);
            }
        }
    }
    out
}

#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub lua_files: usize,
    pub xml_files: usize,
    pub loaded_files: usize,
    pub unlisted_files: usize,
    pub symbols: usize,
    pub api_calls_checked: usize,
    pub api_unverified: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub diagnostics: Vec<Diagnostic>,
    pub stats: Stats,
    pub symbols: Vec<Symbol>,
    pub api_build: String,
    /// Globals defined anywhere in the project; cached by the host for live buffer checks.
    #[serde(skip)]
    pub globals: BTreeSet<String>,
    /// Honest scope statement shown with every report.
    pub scope: String,
}

pub const SCOPE_NOTE: &str = "Static analysis only: syntax, TOC/file/asset structure, and API usage compared with the bundled snapshot. It cannot prove runtime behaviour, taint, secret-value handling or combat lockdown. Findings marked 'needs game test' require the real client.";

/// Lints that operate on one Lua file's analysis. Shared by project validation and live buffer checks.
pub fn lint_lua(file: &str, src: &str, api: &ApiIndex, notes: &Notes, project_globals: &BTreeSet<String>, stats: Option<&mut Stats>) -> (Vec<Diagnostic>, Vec<Symbol>, lua::Analysis) {
    let mut diags = lua::syntax_check(file, src);
    let toks = lua::tokenize(src);
    let a = lua::analyze(file, &toks);
    let mut checked = 0usize;
    let mut unverified = 0usize;
    // Names that this file tests for existence (`if X then`, `X and`, `type(X)`): feature-detected, so a missing API is handled.
    let guarded: BTreeSet<&str> = a.refs.iter().filter(|r| !r.is_call && !r.chain.contains('.')).map(|r| r.chain.as_str()).collect();
    for r in &a.refs {
        let first = r.chain.split('.').next().unwrap_or("");
        if a.declared.contains(first) || is_lua_builtin(first) || project_globals.contains(first) {
            continue;
        }
        let (is_ns, rest) = match r.chain.split_once('.') {
            Some((ns, rest)) => (api.namespaces.contains_key(ns), Some((ns, rest))),
            None => (false, None),
        };
        if r.chain.contains('.') {
            let (ns, rest) = rest.unwrap();
            if is_ns {
                checked += 1;
                let fnname = rest.split('.').next().unwrap_or(rest);
                if r.is_call && !api.namespaces[ns].contains(fnname) {
                    unverified += 1;
                    diags.push(Diagnostic::new(Severity::Warning, "api.unknown-namespace-function", format!("{ns}.{fnname} is not listed in the API snapshot (build {}). This may mean it was removed on Forever, or that the snapshot lacks it. Confirm in game.", api.build), "api", Confidence::SnapshotAbsence).at(file, r.line, r.col).needs_game());
                }
            } else if first.starts_with("C_") {
                checked += 1;
                unverified += 1;
                diags.push(Diagnostic::new(Severity::Warning, "api.unknown-namespace", format!("Namespace {first} is not in the API snapshot (build {}); documentation may simply be missing.", api.build), "api", Confidence::SnapshotAbsence).at(file, r.line, r.col).needs_game());
            }
            continue;
        }
        if !r.is_call {
            continue;
        }
        checked += 1;
        if guarded.contains(first) && !api.globals.contains(first) {
            diags.push(Diagnostic::new(Severity::Hint, "api.feature-detected", format!("{first}() is absent from the snapshot but this file tests for it before use; fallback path looks intentional."), "api", Confidence::Heuristic).at(file, r.line, r.col));
            continue;
        }
        if notes.removed.contains(first) && !api.globals.contains(first) {
            let hint = notes.replacements.get(first).map(|s| format!(" Try {s}.")).unwrap_or_default();
            diags.push(Diagnostic::new(Severity::Warning, "api.removed-global", format!("{first}() is reported absent on Forever and is not in the snapshot ({}).{hint}", notes.removed_source), "api", Confidence::Sourced).at(file, r.line, r.col).needs_game());
            continue;
        }
        if first == "ReloadUI" {
            diags.push(Diagnostic::new(Severity::Warning, "wow.protected-reloadui", "ReloadUI() is protected on Forever; buttons that call it are blocked. Ask the user to type /reload.", "wow-lint", Confidence::Sourced).at(file, r.line, r.col).needs_game());
        }
        if let Some(ns) = notes.by_name.get(first) {
            if ns.iter().any(|(c, _, _)| c == "secret") && matches!(first, "UnitHealth" | "UnitHealthMax" | "UnitHealthPercent" | "UnitHealthMissing") {
                diags.push(Diagnostic::new(Severity::Info, "wow.secret-value-risk", format!("{first}() may return a secret value in combat; do not compare or do arithmetic on it without issecretvalue/canaccessvalue. Prefer widget-driven bars."), "wow-lint", Confidence::Sourced).at(file, r.line, r.col).needs_game());
            }
        }
        if !api.globals.contains(first) {
            unverified += 1;
            diags.push(Diagnostic::new(Severity::Info, "api.unknown-global", format!("{first}() is not in the API snapshot, this project, or the Lua stdlib. Possibly a missing doc, a library, or a typo."), "api", Confidence::SnapshotAbsence).at(file, r.line, r.col));
        }
    }
    for ev in &a.events {
        if !api.events.contains(&ev.event) {
            diags.push(Diagnostic::new(Severity::Warning, "api.unknown-event", format!("Event {} is not in the snapshot. On Forever, registering a non-existent event throws and aborts the file (measured by forever-addon-kit): wrap in pcall if it may not exist.", ev.event), "api", Confidence::SnapshotAbsence).at(file, ev.line, ev.col).needs_game());
        }
        if ev.event == "COMBAT_LOG_EVENT_UNFILTERED" {
            diags.push(Diagnostic::new(Severity::Info, "wow.combat-log-restricted", "The combat log is restricted on Forever and CombatLogGetCurrentEventInfo is absent; see UNIT_COMBAT / C_DamageMeter.", "wow-lint", Confidence::Sourced).at(file, ev.line, ev.col).needs_game());
        }
    }
    // version-check trap: select(4, GetBuildInfo()) compared with 100000-ish
    let compact: String = src.split_whitespace().collect();
    if let Some(p) = compact.find("select(4,GetBuildInfo())") {
        let after = &compact[p..];
        if after.len() > 26 && (after[24..].starts_with(">=1") || after[24..].starts_with(">1")) {
            let line = src.lines().position(|l| l.contains("GetBuildInfo")).map(|x| x as u32 + 1).unwrap_or(1);
            diags.push(Diagnostic::new(Severity::Warning, "wow.version-trap", "Forever reports build number 16001; tests like select(4, GetBuildInfo()) >= 100000 pick the Classic path or refuse to load.", "wow-lint", Confidence::Sourced).at(file, line, 1).needs_game());
        }
    }
    if let Some(s) = stats {
        s.api_calls_checked += checked;
        s.api_unverified += unverified;
    }
    let syms = a.symbols.clone();
    (diags, syms, a)
}

pub fn validate(root: &Path, api: &ApiIndex, notes: &Notes) -> Report {
    let mut diags: Vec<Diagnostic> = vec![];
    let mut stats = Stats::default();
    let info = open_info(root);
    let files = list_files(root);
    if info.tocs.is_empty() {
        diags.push(Diagnostic::new(Severity::Error, "toc.missing", "No .toc file in the project root; WoW will not load this folder as an addon.", "toc", Confidence::Certain));
    }
    if let Some(t) = info.tocs.iter().find(|t| t.title.is_none() && !t.entries.is_empty()) {
        diags.push(Diagnostic::new(Severity::Info, "toc.no-title", "No '## Title' (the folder name is shown instead).", "toc", Confidence::Certain).at(&t.file, 1, 1));
    }
    let mut loaded: BTreeSet<String> = BTreeSet::new();
    let mut xml_queue: Vec<(String, String)> = vec![]; // (xml rel path, from)
    for t in &info.tocs {
        diags.extend(t.diagnostics.clone());
        let stem = addon_name_from_toc(&t.file);
        if stem != info.name && !info.name.is_empty() && t.file == info.main_toc.clone().unwrap_or_default() {
            diags.push(Diagnostic::new(Severity::Info, "toc.folder-mismatch", format!("TOC is named '{stem}' but the folder is '{}'. WoW requires the installed folder name to match; packaging/deploy will use '{stem}'.", info.name), "toc", Confidence::Certain).at(&t.file, 1, 1));
        }
        if t.interface.is_empty() {
            diags.push(Diagnostic::new(Severity::Warning, "toc.no-interface", "No '## Interface' line; the client will mark the addon out of date.", "toc", Confidence::Certain).at(&t.file, 1, 1));
        } else if !t.interface.contains(&16001) {
            diags.push(Diagnostic::new(Severity::Info, "toc.no-forever-interface", format!("Interface {:?} does not include 16001, the value measured for WoW: Forever. Add 16001 to load without 'out of date' prompts.", t.interface), "toc", Confidence::Sourced).at(&t.file, 1, 1));
        }
        let mut seen: HashMap<String, u32> = HashMap::new();
        for e in &t.entries {
            if let Some(prev) = seen.insert(e.path.to_lowercase(), e.line) {
                diags.push(Diagnostic::new(Severity::Warning, "toc.duplicate-entry", format!("'{}' is listed twice (first at line {prev}); it would load twice.", e.raw), "toc", Confidence::Certain).at(&t.file, e.line, 1));
            }
            if e.raw.contains('/') {
                diags.push(Diagnostic::new(Severity::Hint, "toc.forward-slash", "TOCs conventionally use backslashes; forward slashes also work on current clients.", "toc", Confidence::Heuristic).at(&t.file, e.line, 1));
            }
            let (exists, actual) = lookup_ci(root, &e.path);
            if !exists {
                diags.push(Diagnostic::new(Severity::Error, "toc.missing-file", format!("'{}' is listed in the TOC but does not exist.", e.raw), "toc", Confidence::Certain).at(&t.file, e.line, 1));
                continue;
            }
            if let Some(a) = actual {
                diags.push(Diagnostic::new(Severity::Warning, "toc.case-mismatch", format!("'{}' differs in letter case from the file on disk ('{a}'). Works on Windows, fails on case-sensitive filesystems.", e.raw), "toc", Confidence::Certain).at(&t.file, e.line, 1));
            }
            loaded.insert(e.path.clone());
            if e.path.to_lowercase().ends_with(".xml") {
                xml_queue.push((e.path.clone(), t.file.clone()));
            }
        }
        for dep in &t.dependencies {
            diags.push(Diagnostic::new(Severity::Info, "toc.dependency", format!("Requires addon '{dep}' (must be installed alongside; cannot be verified offline here)."), "toc", Confidence::Certain).at(&t.file, 1, 1));
        }
    }
    // follow XML includes
    let mut visited_xml: BTreeSet<String> = BTreeSet::new();
    while let Some((x, _from)) = xml_queue.pop() {
        if !visited_xml.insert(x.clone()) { continue; }
        let Some(text) = read_text(&root.join(&x)) else { continue };
        let dir = Path::new(&x).parent().map(|p| p.to_string_lossy().replace('\\', "/")).unwrap_or_default();
        for (r, kind, line) in xml_file_refs(&text) {
            let rel = r.replace('\\', "/");
            if kind == "asset" {
                check_asset(root, &info.addon_name, &r, &x, line, 1, &mut diags);
                continue;
            }
            let full = if dir.is_empty() { rel.clone() } else { format!("{dir}/{rel}") };
            let (exists, actual) = lookup_ci(root, &full);
            if !exists {
                diags.push(Diagnostic::new(Severity::Error, "xml.missing-file", format!("'{r}' referenced from XML does not exist."), "xml", Confidence::Certain).at(&x, line, 1));
            } else {
                if actual.is_some() {
                    diags.push(Diagnostic::new(Severity::Warning, "xml.case-mismatch", format!("'{r}' differs in letter case from the file on disk."), "xml", Confidence::Certain).at(&x, line, 1));
                }
                loaded.insert(full.clone());
                if full.to_lowercase().ends_with(".xml") { xml_queue.push((full, x.clone())); }
            }
        }
    }
    // collect project-defined globals first so cross-file globals are not flagged
    let lua_paths: Vec<&FileEntry> = files.iter().filter(|f| !f.is_dir && !f.is_symlink && f.path.to_lowercase().ends_with(".lua")).collect();
    stats.xml_files = files.iter().filter(|f| !f.is_dir && f.path.to_lowercase().ends_with(".xml")).count();
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    let mut project_globals: BTreeSet<String> = BTreeSet::new();
    for f in &lua_paths {
        if let Some(src) = read_text(&root.join(&f.path)) {
            let a = lua::analyze(&f.path, &lua::tokenize(&src));
            project_globals.extend(a.globals_defined);
            sources.insert(f.path.clone(), src);
        }
    }
    for t in info.tocs.iter() {
        for sv in t.saved_variables.iter().chain(&t.saved_variables_per_character) { project_globals.insert(sv.clone()); }
    }
    let mut all_symbols = vec![];
    for (path, src) in &sources {
        stats.lua_files += 1;
        let is_loaded = loaded.contains(path);
        let (mut d, syms, a) = lint_lua(path, src, api, notes, &project_globals, if is_loaded { Some(&mut stats) } else { None });
        if !is_loaded {
            // unlisted files (tests, tools) get syntax errors only; API noise would be misleading
            d.retain(|x| x.code == "lua.syntax");
            stats.unlisted_files += 1;
        } else {
            stats.loaded_files += 1;
        }
        diags.extend(d);
        for (s, line, col) in &a.strings {
            if is_loaded { check_asset(root, &info.addon_name, s, path, *line, *col, &mut diags); }
        }
        all_symbols.extend(syms);
    }
    for f in &lua_paths {
        if !loaded.contains(&f.path) && !f.path.to_lowercase().starts_with("tests/") && !f.path.to_lowercase().starts_with("tools/") {
            diags.push(Diagnostic::new(Severity::Info, "project.unlisted-lua", "Lua file is not loaded by any TOC or XML include (may be dead code or loaded dynamically).", "project", Confidence::Certain).at(&f.path, 1, 1));
        }
    }
    stats.symbols = all_symbols.len();
    diags.sort_by(|a, b| (a.severity, &a.file, a.line).cmp(&(b.severity, &b.file, b.line)));
    Report { diagnostics: diags, stats, symbols: all_symbols, api_build: api.build.clone(), globals: project_globals, scope: SCOPE_NOTE.into() }
}

const ASSET_EXTS: &[&str] = &["tga", "blp", "png", "jpg", "ogg", "mp3", "wav", "ttf", "otf"];

fn check_asset(root: &Path, addon: &str, s: &str, file: &str, line: u32, col: u32, diags: &mut Vec<Diagnostic>) {
    let norm = s.replace('\\', "/");
    let lower = norm.to_lowercase();
    let prefix = format!("interface/addons/{}/", addon.to_lowercase());
    let Some(rest) = lower.strip_prefix(&prefix) else { return };
    let rest_orig = &norm[prefix.len()..];
    if rest.is_empty() || rest.ends_with('/') || rest.contains('%') || rest.contains('"') { return; } // format strings / dir refs
    let has_ext = Path::new(rest).extension().is_some_and(|e| ASSET_EXTS.contains(&e.to_string_lossy().to_lowercase().as_str()));
    let candidates: Vec<String> = if has_ext || Path::new(rest).extension().is_some() { vec![rest_orig.to_string()] } else { ASSET_EXTS[..3].iter().map(|e| format!("{rest_orig}.{e}")).collect() };
    let mut case_issue = None;
    for c in &candidates {
        let (ex, actual) = lookup_ci(root, c);
        if ex {
            case_issue = actual;
            if case_issue.is_none() { return; }
            break;
        }
    }
    match case_issue {
        Some(a) => diags.push(Diagnostic::new(Severity::Warning, "asset.case-mismatch", format!("Asset path '{s}' differs in letter case from '{a}' on disk."), "asset", Confidence::Certain).at(file, line, col)),
        None => diags.push(Diagnostic::new(Severity::Warning, "asset.missing", format!("Asset '{s}' not found in the project (looked for {}).", candidates.join(", ")), "asset", Confidence::Certain).at(file, line, col)),
    }
}

pub fn evidence_label(e: Evidence) -> &'static str {
    match e { Evidence::Static => "static", Evidence::NeedsGameTest => "needs-game-test" }
}

pub fn root_join(root: &Path, rel: &str) -> PathBuf { root.join(rel) }
