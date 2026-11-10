//! Packaging and deployment. Never modifies the source project. Never follows symlinks.
use serde::Serialize;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const ALWAYS_SKIP: &[&str] = &[".git", ".github", ".svn", ".hg", "node_modules", ".vscode", ".idea"];

/// Read `.pkgmeta` `ignore:` entries (BigWigs-packager style); simple list parser.
pub fn pkgmeta_ignores(root: &Path) -> Vec<String> {
    let Ok(t) = fs::read_to_string(root.join(".pkgmeta")) else { return vec![] };
    let mut out = vec![];
    let mut in_ignore = false;
    for l in t.lines() {
        if !l.starts_with(' ') && !l.starts_with('\t') && !l.trim().is_empty() {
            in_ignore = l.trim_end().eq_ignore_ascii_case("ignore:");
            continue;
        }
        if in_ignore {
            if let Some(v) = l.trim().strip_prefix("- ") {
                out.push(v.trim().trim_matches('"').trim_matches('\'').to_string());
            }
        }
    }
    out
}

fn ignored(rel: &str, ignores: &[String]) -> bool {
    let first = rel.split('/').next().unwrap_or("");
    if ALWAYS_SKIP.contains(&first) || rel.split('/').any(|c| ALWAYS_SKIP.contains(&c)) {
        return true;
    }
    ignores.iter().any(|ig| {
        let ig = ig.trim_end_matches('/');
        if let Some(ext) = ig.strip_prefix("*.") {
            return rel.ends_with(&format!(".{ext}"));
        }
        rel == ig || rel.starts_with(&format!("{ig}/"))
    }) || rel.ends_with(".zip")
}

/// Files that would be shipped: (relative path with '/', absolute path). Skips symlinks and ignored entries.
pub fn collect(root: &Path) -> (Vec<(String, PathBuf)>, Vec<String>) {
    let ignores = pkgmeta_ignores(root);
    let mut files = vec![];
    let mut skipped = vec![];
    for e in WalkDir::new(root).follow_links(false).sort_by_file_name() {
        let Ok(e) = e else { continue };
        if e.depth() == 0 { continue; }
        let rel = crate::fsguard::to_rel_string(root, e.path());
        if e.path_is_symlink() {
            skipped.push(format!("{rel} (symbolic link)"));
            continue;
        }
        if ignored(&rel, &ignores) {
            if e.file_type().is_file() { skipped.push(format!("{rel} (ignored)")); }
            continue;
        }
        if e.file_type().is_file() {
            files.push((rel, e.path().to_path_buf()));
        }
    }
    (files, skipped)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageResult {
    pub path: String,
    pub files: usize,
    pub bytes: u64,
    pub skipped: Vec<String>,
}

pub fn sanitize_addon_name(name: &str) -> Result<String, String> {
    if name.is_empty() || name.contains(['/', '\\', '\0']) || name == "." || name == ".." || name.starts_with('.') {
        return Err(format!("'{name}' is not a valid addon folder name"));
    }
    Ok(name.to_string())
}

pub fn package(root: &Path, addon_name: &str, out_zip: &Path) -> Result<PackageResult, String> {
    let addon = sanitize_addon_name(addon_name)?;
    let (files, skipped) = collect(root);
    if files.is_empty() { return Err("nothing to package".into()); }
    if let Some(p) = out_zip.parent() {
        if out_zip.canonicalize().map(|c| c.starts_with(root)).unwrap_or(false) || p.canonicalize().map(|c| c.starts_with(root)).unwrap_or(false) {
            return Err("refusing to write the package inside the project folder; choose another location".into());
        }
    }
    let tmp = out_zip.with_extension("zip.part");
    let f = fs::File::create(&tmp).map_err(|e| format!("cannot create {}: {e}", tmp.display()))?;
    let mut zw = zip::ZipWriter::new(f);
    let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).last_modified_time(zip::DateTime::default());
    let mut bytes = 0u64;
    for (rel, abs) in &files {
        zw.start_file(format!("{addon}/{rel}"), opts).map_err(|e| e.to_string())?;
        let mut buf = vec![];
        fs::File::open(abs).and_then(|mut f| f.read_to_end(&mut buf)).map_err(|e| format!("read {rel}: {e}"))?;
        bytes += buf.len() as u64;
        zw.write_all(&buf).map_err(|e| e.to_string())?;
    }
    zw.finish().map_err(|e| e.to_string())?;
    fs::rename(&tmp, out_zip).map_err(|e| format!("cannot finalise {}: {e}", out_zip.display()))?;
    Ok(PackageResult { path: out_zip.display().to_string(), files: files.len(), bytes, skipped })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployPlan {
    pub destination: String,
    pub exists: bool,
    pub files: usize,
    pub bytes: u64,
    pub is_symlink: bool,
}

pub fn plan(root: &Path, addons_dir: &Path, addon_name: &str) -> Result<DeployPlan, String> {
    let addon = sanitize_addon_name(addon_name)?;
    if !addons_dir.is_dir() { return Err(format!("{} is not an existing folder", addons_dir.display())); }
    let dest = addons_dir.join(&addon);
    let (files, _) = collect(root);
    let bytes = files.iter().filter_map(|(_, p)| fs::metadata(p).ok()).map(|m| m.len()).sum();
    Ok(DeployPlan { destination: dest.display().to_string(), exists: dest.symlink_metadata().is_ok(), files: files.len(), bytes, is_symlink: dest.symlink_metadata().map(|m| m.file_type().is_symlink()).unwrap_or(false) })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    pub destination: String,
    pub files: usize,
    pub backup: Option<String>,
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    for e in WalkDir::new(src).follow_links(false) {
        let e = e?;
        if e.path_is_symlink() { continue; }
        let t = dst.join(e.path().strip_prefix(src).unwrap());
        if e.file_type().is_dir() { fs::create_dir_all(&t)?; } else { if let Some(p) = t.parent() { fs::create_dir_all(p)?; } fs::copy(e.path(), &t)?; }
    }
    Ok(())
}

/// Deploy a copy of the project. If the destination exists, `confirm_overwrite` must be true; the previous
/// install is first copied to `backup_root` (kept) and then replaced via a staged swap.
pub fn deploy(root: &Path, addons_dir: &Path, addon_name: &str, confirm_overwrite: bool, backup_root: &Path, stamp: &str) -> Result<DeployResult, String> {
    let p = plan(root, addons_dir, addon_name)?;
    let dest = PathBuf::from(&p.destination);
    if p.is_symlink { return Err("destination is a symbolic link; refusing to write through it".into()); }
    let addons_canon = addons_dir.canonicalize().map_err(|e| e.to_string())?;
    if dest.parent().map(|d| d.canonicalize().ok()) != Some(Some(addons_canon.clone())) { return Err("destination escapes the AddOns folder".into()); }
    if dest.canonicalize().map(|c| c.starts_with(root)).unwrap_or(false) || root.starts_with(&dest) { return Err("source and destination overlap".into()); }
    let mut backup = None;
    if p.exists {
        if !confirm_overwrite { return Err("destination exists: overwrite must be confirmed".into()); }
        let b = backup_root.join(format!("{}-{stamp}", sanitize_addon_name(addon_name)?));
        fs::create_dir_all(&b).map_err(|e| format!("cannot create backup folder: {e}"))?;
        copy_tree(&dest, &b).map_err(|e| format!("backup failed, nothing changed: {e}"))?;
        backup = Some(b.display().to_string());
    }
    let staging = addons_canon.join(format!(".{addon_name}.wfs-staging"));
    let old = addons_canon.join(format!(".{addon_name}.wfs-old"));
    let _ = fs::remove_dir_all(&staging);
    let _ = fs::remove_dir_all(&old);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let (files, _) = collect(root);
    for (rel, abs) in &files {
        let t = staging.join(rel);
        if let Some(pp) = t.parent() { fs::create_dir_all(pp).map_err(|e| e.to_string())?; }
        if let Err(e) = fs::copy(abs, &t) { let _ = fs::remove_dir_all(&staging); return Err(format!("copy {rel}: {e}")); }
    }
    if p.exists { fs::rename(&dest, &old).map_err(|e| { let _ = fs::remove_dir_all(&staging); format!("cannot move existing install aside: {e}") })?; }
    if let Err(e) = fs::rename(&staging, &dest) {
        if p.exists { let _ = fs::rename(&old, &dest); }
        return Err(format!("could not activate new copy (previous install restored): {e}"));
    }
    let _ = fs::remove_dir_all(&old);
    Ok(DeployResult { destination: dest.display().to_string(), files: files.len(), backup })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk(root: &Path) {
        fs::create_dir_all(root.join("Core")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::create_dir_all(root.join("tests")).unwrap();
        fs::write(root.join("A.toc"), "## Interface: 16001\nCore\\x.lua\n").unwrap();
        fs::write(root.join("Core/x.lua"), "return 1").unwrap();
        fs::write(root.join(".git/config"), "x").unwrap();
        fs::write(root.join("tests/t.lua"), "x").unwrap();
        fs::write(root.join(".pkgmeta"), "package-as: A\nignore:\n    - tests\n").unwrap();
    }

    #[test]
    fn package_respects_pkgmeta_and_does_not_touch_source() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("src");
        fs::create_dir_all(&root).unwrap();
        mk(&root);
        let root = root.canonicalize().unwrap();
        let before: Vec<_> = WalkDir::new(&root).into_iter().filter_map(|e| e.ok()).map(|e| e.path().to_path_buf()).collect();
        let out = d.path().join("A.zip");
        let r = package(&root, "A", &out).unwrap();
        assert_eq!(r.files, 3); // A.toc, Core/x.lua, .pkgmeta
        let mut z = zip::ZipArchive::new(fs::File::open(&out).unwrap()).unwrap();
        let names: Vec<_> = (0..z.len()).map(|i| z.by_index(i).unwrap().name().to_string()).collect();
        assert!(names.contains(&"A/Core/x.lua".to_string()) && !names.iter().any(|n| n.contains("tests") || n.contains(".git")));
        let after: Vec<_> = WalkDir::new(&root).into_iter().filter_map(|e| e.ok()).map(|e| e.path().to_path_buf()).collect();
        assert_eq!(before, after);
        assert!(package(&root, "A", &root.join("in.zip")).is_err());
    }

    #[test]
    fn deploy_requires_confirmation_and_backs_up() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join("src");
        fs::create_dir_all(&root).unwrap();
        mk(&root);
        let root = root.canonicalize().unwrap();
        let addons = d.path().join("AddOns");
        fs::create_dir_all(addons.join("A")).unwrap();
        fs::write(addons.join("A/old.lua"), "old").unwrap();
        let backups = d.path().join("bk");
        assert!(deploy(&root, &addons, "A", false, &backups, "t1").is_err());
        assert!(addons.join("A/old.lua").exists());
        let r = deploy(&root, &addons, "A", true, &backups, "t1").unwrap();
        assert!(addons.join("A/Core/x.lua").exists() && !addons.join("A/old.lua").exists());
        assert!(Path::new(&r.backup.unwrap()).join("old.lua").exists());
        assert!(deploy(&root, &addons, "../evil", true, &backups, "t2").is_err());
    }
}
