//! Scoped filesystem access. All project file operations go through here.
use std::path::{Component, Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum GuardError {
    #[error("path escapes the approved folder: {0}")]
    Escape(String),
    #[error("path is not valid: {0}")]
    Invalid(String),
    #[error("io error on {0}: {1}")]
    Io(String, String),
}

/// Normalise a user supplied relative path to forward-slash form, rejecting `..`, absolute and prefix components.
pub fn clean_rel(rel: &str) -> Result<PathBuf, GuardError> {
    if rel.contains('\0') {
        return Err(GuardError::Invalid(rel.replace('\0', "")));
    }
    let norm = rel.replace('\\', "/");
    let mut out = PathBuf::new();
    for comp in Path::new(&norm).components() {
        match comp {
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return Err(GuardError::Escape(rel.to_string())),
        }
    }
    Ok(out)
}

/// Resolve `rel` under `root` for reading or writing, following symlinks only if the final target stays inside `root`.
/// `root` must already be canonical. The target need not exist (for creating files): the nearest existing ancestor is canonicalised instead.
pub fn resolve_within(root: &Path, rel: &str) -> Result<PathBuf, GuardError> {
    let rel = clean_rel(rel)?;
    let joined = root.join(&rel);
    let mut existing = joined.as_path();
    let mut tail: Vec<&std::ffi::OsStr> = vec![];
    loop {
        if existing.symlink_metadata().is_ok() {
            break;
        }
        match (existing.parent(), existing.file_name()) {
            (Some(p), Some(n)) => {
                tail.push(n);
                existing = p;
            }
            _ => return Err(GuardError::Invalid(rel.display().to_string())),
        }
    }
    let canon = existing
        .canonicalize()
        .map_err(|e| GuardError::Io(existing.display().to_string(), e.to_string()))?;
    if !canon.starts_with(root) {
        return Err(GuardError::Escape(rel.display().to_string()));
    }
    let mut out = canon;
    for t in tail.into_iter().rev() {
        out.push(t);
    }
    Ok(out)
}

pub fn to_rel_string(root: &Path, p: &Path) -> String {
    p.strip_prefix(root)
        .unwrap_or(p)
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_and_absolute() {
        assert!(clean_rel("../x").is_err());
        assert!(clean_rel("a/../../x").is_err());
        assert!(clean_rel("/etc/passwd").is_err());
        assert_eq!(clean_rel("a\\b/c.lua").unwrap(), PathBuf::from("a/b/c.lua"));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_escape_blocked() {
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), "x").unwrap();
        let proj = tempfile::tempdir().unwrap();
        let root = proj.path().canonicalize().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.join("link")).unwrap();
        assert!(resolve_within(&root, "link/secret.txt").is_err());
        assert!(resolve_within(&root, "link/new.txt").is_err());
        assert!(resolve_within(&root, "ok/new.txt").is_ok());
    }
}
