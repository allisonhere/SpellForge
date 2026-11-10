pub mod api;
pub mod diag;
pub mod distribute;
pub mod fsguard;
pub mod lua;
pub mod project;
pub mod settings;
pub mod toc;

use api::{ApiIndex, Notes};
use serde::Serialize;
use settings::{Installation, Settings};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

const MAX_TEXT_BYTES: u64 = 5 * 1024 * 1024;

pub struct AppState {
    settings_path: PathBuf,
    data_dir: PathBuf,
    settings: Mutex<Settings>,
    /// Canonical root of the currently open project. Only ever set from an approved path.
    project: Mutex<Option<PathBuf>>,
    api: Mutex<ApiIndex>,
    notes: Notes,
    /// Project-defined globals from the last full validation (avoids false 'unknown global' noise in live checks).
    globals: Mutex<std::collections::BTreeSet<String>>,
}

type R<T> = Result<T, String>;

impl AppState {
    fn root(&self) -> R<PathBuf> {
        self.project.lock().unwrap().clone().ok_or_else(|| "no project is open".to_string())
    }
    fn persist(&self) -> R<()> {
        settings::save(&self.settings_path, &self.settings.lock().unwrap())
    }
    fn approve_and_open(&self, path: &Path) -> R<project::ProjectInfo> {
        let canon = path.canonicalize().map_err(|e| format!("cannot open {}: {e}", path.display()))?;
        if !canon.is_dir() { return Err("not a folder".into()); }
        {
            let mut s = self.settings.lock().unwrap();
            let p = canon.display().to_string();
            s.recent_projects.retain(|x| x != &p);
            s.recent_projects.insert(0, p.clone());
            s.recent_projects.truncate(12);
            s.last_project = Some(p);
        }
        self.persist()?;
        let info = project::open_info(&canon);
        *self.project.lock().unwrap() = Some(canon);
        Ok(info)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Boot {
    settings: Settings,
    api_origin: String,
    api_build: String,
    detected: Vec<Installation>,
}

#[tauri::command]
fn boot(state: State<AppState>) -> Boot {
    let api = state.api.lock().unwrap();
    let detected = settings::detect_candidates().into_iter().map(|(n, p)| Installation { id: String::new(), name: n, addons_dir: p.display().to_string() }).collect();
    Boot { settings: state.settings.lock().unwrap().clone(), api_origin: api.origin.clone(), api_build: api.build.clone(), detected }
}

#[tauri::command]
fn save_ui(state: State<AppState>, ui: serde_json::Value) -> R<()> {
    state.settings.lock().unwrap().ui = ui;
    state.persist()
}

#[tauri::command]
async fn pick_project(app: tauri::AppHandle, state: State<'_, AppState>) -> R<Option<project::ProjectInfo>> {
    let Some(p) = app.dialog().file().set_title("Open addon folder").blocking_pick_folder() else { return Ok(None) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    state.approve_and_open(&p).map(Some)
}

/// Re-open a previously approved project (recent list only). The frontend cannot open arbitrary paths.
#[tauri::command]
fn open_recent(state: State<AppState>, path: String) -> R<project::ProjectInfo> {
    if !state.settings.lock().unwrap().recent_projects.contains(&path) {
        return Err("that folder is not in the approved list; use Open Folder".into());
    }
    state.approve_and_open(Path::new(&path))
}

/// Open an addon folder found *inside* the already-approved project root (e.g. when the user picked an AddOns folder).
#[tauri::command]
fn open_nested(state: State<AppState>, path: String) -> R<project::ProjectInfo> {
    let root = state.root()?;
    let abs = fsguard::resolve_within(&root, &path).map_err(|e| e.to_string())?;
    if !abs.is_dir() { return Err(format!("{path} is not a folder")); }
    state.approve_and_open(&abs)
}

#[tauri::command]
fn project_info(state: State<AppState>) -> R<project::ProjectInfo> {
    Ok(project::open_info(&state.root()?))
}

#[tauri::command]
fn project_files(state: State<AppState>) -> R<Vec<project::FileEntry>> {
    Ok(project::list_files(&state.root()?))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileContent { path: String, content: String, size: u64 }

#[tauri::command]
fn read_file(state: State<AppState>, path: String) -> R<FileContent> {
    let root = state.root()?;
    let abs = fsguard::resolve_within(&root, &path).map_err(|e| e.to_string())?;
    let md = std::fs::metadata(&abs).map_err(|e| format!("{path}: {e}"))?;
    if !md.is_file() { return Err(format!("{path} is not a file")); }
    if md.len() > MAX_TEXT_BYTES { return Err(format!("{path} is {} bytes; files over 5 MB are not opened in the editor", md.len())); }
    let bytes = std::fs::read(&abs).map_err(|e| format!("{path}: {e}"))?;
    if bytes.contains(&0) { return Err(format!("{path} looks like a binary file")); }
    Ok(FileContent { path, content: String::from_utf8_lossy(&bytes).into_owned(), size: md.len() })
}

#[tauri::command]
fn write_file(state: State<AppState>, path: String, content: String) -> R<()> {
    let root = state.root()?;
    let abs = fsguard::resolve_within(&root, &path).map_err(|e| e.to_string())?;
    if abs.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) {
        return Err("refusing to write through a symbolic link".into());
    }
    if let Some(p) = abs.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let tmp = abs.with_extension("wfs-tmp");
    std::fs::write(&tmp, content).map_err(|e| format!("{path}: {e}"))?;
    std::fs::rename(&tmp, &abs).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn validate_project(state: State<AppState>) -> R<project::Report> {
    let root = state.root()?;
    let api = state.api.lock().unwrap();
    let rep = project::validate(&root, &api, &state.notes);
    *state.globals.lock().unwrap() = rep.globals.clone();
    Ok(rep)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BufferCheck { diagnostics: Vec<diag::Diagnostic>, symbols: Vec<lua::Symbol> }

/// Diagnostics for an unsaved editor buffer (Lua only).
#[tauri::command]
fn check_buffer(state: State<AppState>, path: String, content: String) -> R<BufferCheck> {
    let api = state.api.lock().unwrap();
    let (diagnostics, symbols, _) = project::lint_lua(&path, &content, &api, &state.notes, &state.globals.lock().unwrap(), None);
    Ok(BufferCheck { diagnostics, symbols })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hit { file: String, line: u32, col: u32, text: String }

#[tauri::command]
fn search_project(state: State<AppState>, query: String, case_sensitive: bool, identifier: bool) -> R<Vec<Hit>> {
    if query.is_empty() { return Ok(vec![]); }
    let root = state.root()?;
    let q = if case_sensitive { query.clone() } else { query.to_lowercase() };
    let mut hits = vec![];
    'files: for f in project::list_files(&root) {
        let lower = f.path.to_lowercase();
        if f.is_dir || f.is_symlink || f.size > MAX_TEXT_BYTES || !(lower.ends_with(".lua") || lower.ends_with(".xml") || lower.ends_with(".toc") || lower.ends_with(".md") || lower.ends_with(".txt")) { continue; }
        let Ok(bytes) = std::fs::read(root.join(&f.path)) else { continue };
        let text = String::from_utf8_lossy(&bytes);
        if identifier && lower.ends_with(".lua") {
            for t in lua::tokenize(&text) {
                if t.kind == lua::TokKind::Name && t.text == query {
                    let line = text.lines().nth(t.line as usize - 1).unwrap_or("").trim().to_string();
                    hits.push(Hit { file: f.path.clone(), line: t.line, col: t.col, text: line });
                    if hits.len() >= 500 { break 'files; }
                }
            }
            continue;
        }
        for (i, l) in text.lines().enumerate() {
            let hay = if case_sensitive { l.to_string() } else { l.to_lowercase() };
            if let Some(c) = hay.find(&q) {
                hits.push(Hit { file: f.path.clone(), line: i as u32 + 1, col: c as u32 + 1, text: l.trim().chars().take(200).collect() });
                if hits.len() >= 500 { break 'files; }
            }
        }
    }
    Ok(hits)
}

#[tauri::command]
fn api_index(state: State<AppState>) -> String { state.api.lock().unwrap().raw.clone() }

#[tauri::command]
fn compat_notes() -> &'static str { api::BUNDLED_NOTES }

/// Import a newer snapshot (compiled index format, schema 1) from a local file. Fully offline.
#[tauri::command]
async fn import_api_snapshot(app: tauri::AppHandle, state: State<'_, AppState>) -> R<Option<String>> {
    let Some(p) = app.dialog().file().set_title("Import API snapshot (forever-api-index.json)").add_filter("JSON", &["json"]).blocking_pick_file() else { return Ok(None) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    let md = std::fs::metadata(&p).map_err(|e| e.to_string())?;
    if md.len() > 64 * 1024 * 1024 { return Err("snapshot is unreasonably large".into()); }
    let raw = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let idx = ApiIndex::from_raw(raw.clone(), "imported")?;
    let build = idx.build.clone();
    std::fs::create_dir_all(&state.data_dir).map_err(|e| e.to_string())?;
    std::fs::write(state.data_dir.join("api-index.user.json"), raw).map_err(|e| e.to_string())?;
    *state.api.lock().unwrap() = idx;
    Ok(Some(build))
}

#[tauri::command]
fn reset_api_snapshot(state: State<AppState>) -> R<()> {
    let _ = std::fs::remove_file(state.data_dir.join("api-index.user.json"));
    *state.api.lock().unwrap() = ApiIndex::bundled();
    Ok(())
}

#[tauri::command]
async fn add_installation(app: tauri::AppHandle, state: State<'_, AppState>) -> R<Vec<Installation>> {
    let Some(p) = app.dialog().file().set_title("Select a WoW folder (game root, _forever_ flavour, or Interface/AddOns)").blocking_pick_folder() else { return Ok(state.settings.lock().unwrap().installations.clone()) };
    let p = p.into_path().map_err(|e| e.to_string())?;
    let found = settings::find_addons_dirs(&p);
    if found.is_empty() { return Err("No Interface/AddOns folder found there. Pick the game folder, a flavour folder such as _forever_, or the AddOns folder itself.".into()); }
    {
        let mut s = state.settings.lock().unwrap();
        for (label, dir) in found {
            let canon = dir.canonicalize().map_err(|e| e.to_string())?.display().to_string();
            if s.installations.iter().any(|i| i.addons_dir == canon) { continue; }
            let id = format!("inst{}", s.installations.len() + 1 + s.installations.iter().filter(|i| i.id.starts_with("inst")).count());
            s.installations.push(Installation { id, name: label, addons_dir: canon });
        }
    }
    state.persist()?;
    Ok(state.settings.lock().unwrap().installations.clone())
}

#[tauri::command]
fn remove_installation(state: State<AppState>, id: String) -> R<Vec<Installation>> {
    state.settings.lock().unwrap().installations.retain(|i| i.id != id);
    state.persist()?;
    Ok(state.settings.lock().unwrap().installations.clone())
}

#[tauri::command]
async fn package_project(app: tauri::AppHandle, state: State<'_, AppState>) -> R<Option<distribute::PackageResult>> {
    let root = state.root()?;
    let info = project::open_info(&root);
    let default = format!("{}.zip", info.addon_name);
    let Some(p) = app.dialog().file().set_title("Save addon package").set_file_name(&default).add_filter("ZIP", &["zip"]).blocking_save_file() else { return Ok(None) };
    let out = p.into_path().map_err(|e| e.to_string())?;
    distribute::package(&root, &info.addon_name, &out).map(Some)
}

fn installation(state: &AppState, id: &str) -> R<Installation> {
    state.settings.lock().unwrap().installations.iter().find(|i| i.id == id).cloned().ok_or_else(|| "unknown installation; add it in Settings first".to_string())
}

#[tauri::command]
fn deploy_plan(state: State<AppState>, installation_id: String) -> R<distribute::DeployPlan> {
    let root = state.root()?;
    let inst = installation(&state, &installation_id)?;
    distribute::plan(&root, Path::new(&inst.addons_dir), &project::open_info(&root).addon_name)
}

#[tauri::command]
fn deploy_apply(state: State<AppState>, installation_id: String, confirm_overwrite: bool) -> R<distribute::DeployResult> {
    let root = state.root()?;
    let inst = installation(&state, &installation_id)?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0).to_string();
    distribute::deploy(&root, Path::new(&inst.addons_dir), &project::open_info(&root).addon_name, confirm_overwrite, &state.data_dir.join("backups"), &stamp)
}

#[tauri::command]
async fn create_addon(app: tauri::AppHandle, state: State<'_, AppState>, name: String, title: String, author: String) -> R<Option<project::ProjectInfo>> {
    let name = distribute::sanitize_addon_name(&name)?;
    if !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') { return Err("addon name may contain only letters, digits, _ and -".into()); }
    let Some(p) = app.dialog().file().set_title("Choose where to create the addon folder").blocking_pick_folder() else { return Ok(None) };
    let parent = p.into_path().map_err(|e| e.to_string())?.canonicalize().map_err(|e| e.to_string())?;
    let dir = parent.join(&name);
    if dir.exists() { return Err(format!("{} already exists; refusing to overwrite", dir.display())); }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let ident: String = name.replace('-', "_");
    let toc = format!("## Interface: 16001\n## Title: {}\n## Notes: Created with WoW Forever Studio\n## Author: {}\n## Version: 0.1.0\n## SavedVariables: {ident}DB\n\n{name}.lua\n", if title.is_empty() { &name } else { &title }, author);
    let lua = format!("-- {name}: main file (user-maintained)\nlocal addonName, ns = ...\n\nlocal frame = CreateFrame(\"Frame\")\nframe:RegisterEvent(\"PLAYER_LOGIN\")\nframe:SetScript(\"OnEvent\", function(self, event)\n    {ident}DB = {ident}DB or {{}}\n    print(\"|cff7c5cff{name}|r loaded\")\nend)\n");
    std::fs::write(dir.join(format!("{name}.toc")), toc).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(format!("{name}.lua")), lua).map_err(|e| e.to_string())?;
    state.approve_and_open(&dir).map(Some)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cfg = app.path().app_config_dir().map_err(|e| e.to_string())?;
            let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
            let settings_path = cfg.join("settings.json");
            let settings = settings::load(&settings_path);
            let api = std::fs::read_to_string(data.join("api-index.user.json")).ok().and_then(|r| ApiIndex::from_raw(r, "imported").ok()).unwrap_or_else(ApiIndex::bundled);
            app.manage(AppState { settings_path, data_dir: data, settings: Mutex::new(settings), project: Mutex::new(None), api: Mutex::new(api), notes: Notes::bundled(), globals: Default::default() });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            boot, save_ui, pick_project, open_recent, open_nested, project_info, project_files, read_file, write_file, validate_project,
            check_buffer, search_project, api_index, compat_notes, import_api_snapshot, reset_api_snapshot, add_installation,
            remove_installation, package_project, deploy_plan, deploy_apply, create_addon
        ])
        .run(tauri::generate_context!())
        .expect("error while running WoW Forever Studio");
}
