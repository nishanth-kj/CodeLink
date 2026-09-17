use crate::errors::{CoreError, CoreResult};
use globset::{Glob, GlobSet, GlobSetBuilder};
use std::ffi::OsString;
use std::path::{Component, Path, PathBuf};

/// Enforces that every filesystem path CodeLink Core touches resolves to a
/// location inside the workspace root, even across symlinks, `..` segments,
/// absolute paths, or paths that do not exist yet (e.g. a file about to be
/// created). This is the last line of defense before any `std::fs` call;
/// the TypeScript layer performs the same class of check earlier for
/// defense in depth, but Rust must never trust its caller blindly.
#[derive(Clone)]
pub struct WorkspaceGuard {
    root: PathBuf,
}

impl WorkspaceGuard {
    pub fn new(root: impl AsRef<Path>) -> CoreResult<Self> {
        let root = root.as_ref();
        if !root.exists() {
            return Err(CoreError::invalid_argument(format!(
                "Workspace root does not exist: {}",
                root.display()
            )));
        }
        let canonical = dunce::canonicalize(root).map_err(CoreError::from)?;
        Ok(Self { root: canonical })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolves a client-supplied path (relative or absolute) against the
    /// workspace root, returning the real, symlink-resolved absolute path.
    /// Returns `PATH_OUTSIDE_WORKSPACE` if the result would escape the root.
    pub fn resolve(&self, requested: &str) -> CoreResult<PathBuf> {
        if requested.as_bytes().contains(&0) {
            return Err(CoreError::invalid_argument("Path contains a null byte"));
        }
        if requested.trim().is_empty() {
            return Ok(self.root.clone());
        }

        let req_path = Path::new(requested);
        let combined = if req_path.is_absolute() {
            req_path.to_path_buf()
        } else {
            self.root.join(req_path)
        };

        let normalized = lexical_normalize(&combined);
        if !normalized.starts_with(&self.root) {
            return Err(CoreError::path_outside_workspace(requested));
        }

        let real_path = self.resolve_through_symlinks(&normalized, requested)?;
        if !real_path.starts_with(&self.root) {
            return Err(CoreError::path_outside_workspace(requested));
        }

        Ok(real_path)
    }

    /// Walks up from `normalized` to the longest existing ancestor,
    /// canonicalizes that ancestor (resolving any symlinks), then
    /// reattaches the not-yet-existing suffix. This blocks a symlink
    /// inside the workspace from redirecting reads or writes outside it.
    fn resolve_through_symlinks(&self, normalized: &Path, original: &str) -> CoreResult<PathBuf> {
        let mut existing = normalized.to_path_buf();
        let mut suffix: Vec<OsString> = Vec::new();

        while !existing.exists() {
            let Some(name) = existing.file_name() else {
                break;
            };
            suffix.push(name.to_os_string());
            existing = match existing.parent() {
                Some(parent) => parent.to_path_buf(),
                None => break,
            };
            if !existing.starts_with(&self.root) {
                return Err(CoreError::path_outside_workspace(original));
            }
        }

        let canonical_existing = if existing.exists() {
            dunce::canonicalize(&existing).map_err(CoreError::from)?
        } else {
            existing
        };

        let mut real_path = canonical_existing;
        for part in suffix.into_iter().rev() {
            real_path.push(part);
        }
        Ok(real_path)
    }

    /// Converts an absolute, already-resolved path back into a
    /// forward-slashed, workspace-relative display path for MCP responses.
    pub fn to_relative_display(&self, absolute: &Path) -> String {
        let relative = absolute.strip_prefix(&self.root).unwrap_or(absolute);
        let mut display = relative.to_string_lossy().replace('\\', "/");
        if display.is_empty() {
            display = ".".to_string();
        }
        display
    }

    /// Refuses deletion of the workspace root itself.
    pub fn guard_against_root_deletion(&self, target: &Path) -> CoreResult<()> {
        if target == self.root {
            return Err(CoreError::invalid_argument(
                "Refusing to delete the workspace root",
            ));
        }
        Ok(())
    }
}

fn lexical_normalize(path: &Path) -> PathBuf {
    let mut stack: Vec<Component> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => match stack.last() {
                Some(Component::Normal(_)) => {
                    stack.pop();
                }
                _ => stack.push(component),
            },
            other => stack.push(other),
        }
    }
    let mut result = PathBuf::new();
    for component in stack {
        result.push(component.as_os_str());
    }
    result
}

/// Builds a glob set from user-configured exclude patterns (e.g. `.git`,
/// `node_modules`, `.env*`) used to keep sensitive or noisy paths out of
/// directory listings, search results, and direct file access.
pub fn build_exclude_set(patterns: &[String]) -> CoreResult<GlobSet> {
    let mut builder = GlobSetBuilder::new();
    for pattern in patterns {
        let glob = Glob::new(pattern).map_err(|e| {
            CoreError::invalid_argument(format!("Invalid exclude pattern '{pattern}': {e}"))
        })?;
        builder.add(glob);
    }
    builder
        .build()
        .map_err(|e| CoreError::internal(format!("Failed to build exclude glob set: {e}")))
}

pub fn is_excluded(relative_display: &str, exclude_set: &GlobSet) -> bool {
    exclude_set.is_match(relative_display)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn resolves_relative_path_inside_workspace() {
        let dir = make_workspace();
        fs::write(dir.path().join("a.txt"), "hi").unwrap();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let resolved = guard.resolve("a.txt").unwrap();
        assert!(resolved.starts_with(guard.root()));
        assert!(resolved.ends_with("a.txt"));
    }

    #[test]
    fn rejects_parent_traversal() {
        let dir = make_workspace();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let err = guard.resolve("../../../etc/passwd").unwrap_err();
        assert_eq!(err.code, "PATH_OUTSIDE_WORKSPACE");
    }

    #[test]
    fn rejects_absolute_path_outside_workspace() {
        let dir = make_workspace();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let outside = if cfg!(windows) {
            "C:\\Windows\\win.ini"
        } else {
            "/etc/passwd"
        };
        let err = guard.resolve(outside).unwrap_err();
        assert_eq!(err.code, "PATH_OUTSIDE_WORKSPACE");
    }

    #[test]
    fn rejects_null_byte() {
        let dir = make_workspace();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let err = guard.resolve("a\0b").unwrap_err();
        assert_eq!(err.code, "INVALID_ARGUMENT");
    }

    #[test]
    fn allows_nested_subdirectory() {
        let dir = make_workspace();
        fs::create_dir_all(dir.path().join("src/nested")).unwrap();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let resolved = guard.resolve("src/nested/file.ts").unwrap();
        assert!(resolved.starts_with(guard.root()));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let dir = make_workspace();
        let outside = make_workspace();
        fs::write(outside.path().join("secret.txt"), "s3cr3t").unwrap();
        symlink(outside.path(), dir.path().join("escape")).unwrap();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let err = guard.resolve("escape/secret.txt").unwrap_err();
        assert_eq!(err.code, "PATH_OUTSIDE_WORKSPACE");
    }

    #[test]
    fn to_relative_display_uses_forward_slashes() {
        let dir = make_workspace();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        let guard = WorkspaceGuard::new(dir.path()).unwrap();
        let resolved = guard.resolve("src/app.ts").unwrap();
        assert_eq!(guard.to_relative_display(&resolved), "src/app.ts");
    }
}
