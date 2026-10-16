// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Sandboxed workspace file IO for Billy's read_flow / write_flow tools.
//! Paths are relative to the workspace root; anything escaping it (absolute,
//! `..`, symlink traversal) or without a yaml extension is rejected.

use std::fs;
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

fn is_yaml(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()),
        Some(ref e) if e == "yaml" || e == "yml"
    )
}

/// Validate `rel` (relative, normal components only, yaml extension) and
/// return the joined path under the canonicalized workspace root.
fn validate(workspace: &str, rel: &str) -> AppResult<(PathBuf, PathBuf)> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute() {
        return Err(AppError::Other(
            "path must be relative to the workspace".into(),
        ));
    }
    if !rel_path
        .components()
        .all(|c| matches!(c, Component::Normal(_)))
    {
        return Err(AppError::Other(
            "path may not contain '..' or special components".into(),
        ));
    }
    if !is_yaml(rel_path) {
        return Err(AppError::Other("only .yaml/.yml files are allowed".into()));
    }
    let root = fs::canonicalize(workspace)
        .map_err(|e| AppError::Other(format!("workspace not accessible: {e}")))?;
    Ok((root.clone(), root.join(rel_path)))
}

#[tauri::command]
pub fn read_workspace_file(workspace: String, rel_path: String) -> AppResult<String> {
    let (root, joined) = validate(&workspace, &rel_path)?;
    // Canonicalize the existing file to also defeat symlink escapes.
    let real = fs::canonicalize(&joined)
        .map_err(|e| AppError::Other(format!("cannot read {rel_path}: {e}")))?;
    if !real.starts_with(&root) {
        return Err(AppError::Other("path escapes the workspace".into()));
    }
    fs::read_to_string(&real).map_err(AppError::Io)
}

#[tauri::command]
pub fn write_workspace_file(workspace: String, rel_path: String, content: String) -> AppResult<()> {
    let (root, joined) = validate(&workspace, &rel_path)?;
    if let Some(parent) = joined.parent() {
        // Check the deepest folder that already exists BEFORE creating the
        // rest: a symlinked folder pointing outside would otherwise let
        // create_dir_all make directories out there before the check fails.
        let existing = parent
            .ancestors()
            .find(|p| p.exists())
            .ok_or_else(|| AppError::Other("workspace not accessible".into()))?;
        let real_existing = fs::canonicalize(existing).map_err(AppError::Io)?;
        if !real_existing.starts_with(&root) {
            return Err(AppError::Other("path escapes the workspace".into()));
        }
        fs::create_dir_all(parent).map_err(AppError::Io)?;
        let real_parent = fs::canonicalize(parent).map_err(AppError::Io)?;
        if !real_parent.starts_with(&root) {
            return Err(AppError::Other("path escapes the workspace".into()));
        }
    }
    // If the file already exists as a symlink, refuse (write would follow it).
    if joined
        .symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(AppError::Other(
            "refusing to write through a symlink".into(),
        ));
    }
    fs::write(&joined, content).map_err(AppError::Io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn tmp() -> TempDir {
        tempfile::tempdir().expect("tempdir")
    }

    /// Canonicalize the TempDir path (macOS /tmp is a symlink to /private/tmp).
    fn canon_root(dir: &TempDir) -> PathBuf {
        fs::canonicalize(dir.path()).expect("canonicalize tmpdir")
    }

    #[test]
    fn round_trip_write_then_read() {
        let dir = tmp();
        let root = canon_root(&dir);
        let ws = root.to_string_lossy().to_string();

        write_workspace_file(ws.clone(), "login.yaml".into(), "content: hello".into()).unwrap();
        let got = read_workspace_file(ws, "login.yaml".into()).unwrap();
        assert_eq!(got, "content: hello");
    }

    #[test]
    fn write_into_new_subdir() {
        let dir = tmp();
        let root = canon_root(&dir);
        let ws = root.to_string_lossy().to_string();

        write_workspace_file(ws.clone(), "sub/a.yaml".into(), "x: 1".into()).unwrap();
        let file_path = root.join("sub").join("a.yaml");
        assert!(file_path.exists(), "file must exist under root");
        // Verify it is actually under the workspace root.
        let real = fs::canonicalize(&file_path).unwrap();
        assert!(
            real.starts_with(&root),
            "file must be within workspace root"
        );
    }

    #[test]
    fn reject_absolute_path() {
        let dir = tmp();
        let ws = canon_root(&dir).to_string_lossy().to_string();
        let result = read_workspace_file(ws, "/etc/passwd".into());
        assert!(result.is_err(), "absolute path must be rejected");
    }

    #[test]
    fn reject_dotdot_escape() {
        let dir = tmp();
        let ws = canon_root(&dir).to_string_lossy().to_string();
        let result = read_workspace_file(ws, "../escape.yaml".into());
        assert!(result.is_err(), ".. path must be rejected");
    }

    #[test]
    fn reject_non_yaml_extension() {
        let dir = tmp();
        let ws = canon_root(&dir).to_string_lossy().to_string();
        let result = read_workspace_file(ws, "notes.txt".into());
        assert!(result.is_err(), "non-yaml extension must be rejected");
    }

    #[test]
    #[cfg(unix)]
    fn reject_symlink_pointing_outside_workspace() {
        use std::os::unix::fs::symlink;

        let dir = tmp();
        let root = canon_root(&dir);
        let ws = root.to_string_lossy().to_string();

        // Create an outside target file.
        let outside = tmp();
        let outside_root = canon_root(&outside);
        let target = outside_root.join("secret.yaml");
        fs::write(&target, "secret").unwrap();

        // Place a symlink inside the workspace pointing to the outside file.
        let link = root.join("evil.yaml");
        symlink(&target, &link).unwrap();

        let result = read_workspace_file(ws, "evil.yaml".into());
        assert!(
            result.is_err(),
            "symlink escaping workspace must be rejected"
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_folder_pointing_outside_creates_nothing_out_there() {
        use std::os::unix::fs::symlink;
        let ws = tmp();
        let outside = tmp();
        symlink(outside.path(), ws.path().join("link")).unwrap();
        let res = write_workspace_file(
            ws.path().to_string_lossy().into_owned(),
            "link/new/deeper/flow.yaml".into(),
            "- launchApp\n".into(),
        );
        assert!(res.is_err());
        assert!(
            !outside.path().join("new").exists(),
            "a directory was created outside the workspace"
        );
    }

    #[test]
    fn read_missing_file_returns_err() {
        let dir = tmp();
        let ws = canon_root(&dir).to_string_lossy().to_string();
        let result = read_workspace_file(ws, "nonexistent.yaml".into());
        assert!(result.is_err(), "reading a missing file must return Err");
    }
}
