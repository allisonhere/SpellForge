use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Installation {
    pub id: String,
    pub name: String,
    /// Absolute path to an existing `Interface/AddOns` folder.
    pub addons_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub recent_projects: Vec<String>,
    pub last_project: Option<String>,
    pub installations: Vec<Installation>,
    /// Opaque, frontend-owned UI state (layout, open tabs, shortcuts, scenario).
    pub ui: serde_json::Value,
    pub ai: AiSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AiSettings {
    pub enabled: bool,
    /// Must be a loopback address; enforced in backend.
    pub endpoint: String,
    pub model: String,
}
impl Default for AiSettings {
    fn default() -> Self { Self { enabled: false, endpoint: "http://127.0.0.1:1234/v1".into(), model: String::new() } }
}

pub fn load(path: &Path) -> Settings {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// Atomic save: write to a temp file then rename.
pub fn save(path: &Path, s: &Settings) -> Result<(), String> {
    if let Some(p) = path.parent() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Locate AddOns folders beneath a user-picked path (game root, flavour folder, Interface, or AddOns itself).
pub fn find_addons_dirs(picked: &Path) -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    let check = |p: PathBuf, label: String, out: &mut Vec<(String, PathBuf)>| { if p.is_dir() { out.push((label, p)); } };
    if picked.file_name().is_some_and(|n| n.eq_ignore_ascii_case("AddOns")) { check(picked.to_path_buf(), "AddOns".into(), &mut out); return out; }
    check(picked.join("Interface/AddOns"), picked.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(), &mut out);
    if out.is_empty() {
        if let Ok(rd) = std::fs::read_dir(picked) {
            for e in rd.filter_map(|e| e.ok()) {
                let n = e.file_name().to_string_lossy().into_owned();
                if n.starts_with('_') && n.ends_with('_') { check(e.path().join("Interface/AddOns"), n, &mut out); }
            }
        }
    }
    out
}

/// Candidate game locations that exist on this machine. Candidates only: the user must confirm each one.
pub fn detect_candidates() -> Vec<(String, PathBuf)> {
    let mut roots: Vec<PathBuf> = vec![];
    if let Some(h) = directories::BaseDirs::new().map(|d| d.home_dir().to_path_buf()) {
        for rel in [
            "Games/battlenet/drive_c/Program Files (x86)/World of Warcraft",
            "Games/world-of-warcraft/drive_c/Program Files (x86)/World of Warcraft",
            ".wine/drive_c/Program Files (x86)/World of Warcraft",
            ".local/share/Steam/steamapps/common/World of Warcraft",
            ".local/share/lutris/runners/wine",
        ] { roots.push(h.join(rel)); }
    }
    for p in ["C:\\Program Files (x86)\\World of Warcraft", "C:\\Program Files\\World of Warcraft", "D:\\World of Warcraft", "/Applications/World of Warcraft"] { roots.push(PathBuf::from(p)); }
    let mut out = vec![];
    for r in roots { if r.is_dir() { out.extend(find_addons_dirs(&r)); } }
    out
}
