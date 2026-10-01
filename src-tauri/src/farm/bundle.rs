// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! The files a farm run needs: the flow and everything it references.

use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};

/// Same cap as the agent's `run.start`.
pub const MAX_BUNDLE_BYTES: usize = 8 * 1024 * 1024;

/// Maestro keys whose value is a path resolved next to the flow.
const PATH_KEYS: [&str; 4] = ["runFlow", "runScript", "file", "path"];

#[derive(Debug, Clone, PartialEq)]
pub struct FlowBundle {
    /// Path relative to the bundle root (forward slashes) → UTF-8 content.
    pub files: BTreeMap<String, String>,
    /// The flows to run, relative to the root.
    pub entry: Vec<String>,
}

/// Path values of `runFlow:` / `runScript:` / `file:` / `path:` lines.
pub fn referenced_paths(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim_start();
        let trimmed = trimmed.strip_prefix("- ").unwrap_or(trimmed).trim_start();
        let Some((key, value)) = trimmed.split_once(':') else {
            continue;
        };
        if !PATH_KEYS.contains(&key.trim()) {
            continue;
        }
        let value = value.split(" #").next().unwrap_or("").trim();
        let value = value.trim_matches(|c| c == '"' || c == '\'');
        if value.is_empty() || value.contains("://") || value == "|" || value == ">" {
            continue;
        }
        out.push(value.to_string());
    }
    out
}

fn is_yaml(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("yaml" | "yml")
    )
}

fn is_config(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|n| n.to_str()),
        Some("config.yaml" | "config.yml")
    )
}

/// Resolve `.` and `..` without touching the filesystem.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn relative(root: &Path, path: &Path) -> AppResult<String> {
    let rel = path.strip_prefix(root).map_err(|_| {
        AppError::RunnerFailed(format!("{} is outside the workspace", path.display()))
    })?;
    Ok(rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/"))
}

/// Collect `target` (a flow, or a folder whose top-level flows all run) and
/// the files its flows reference, relative to `root` when `target` is inside
/// it, else to the flow's own folder.
pub fn collect(target: &Path, root: Option<&Path>) -> AppResult<FlowBundle> {
    let target = normalize(target);
    let base = match root.map(normalize) {
        Some(r) if target.starts_with(&r) => r,
        _ if target.is_dir() => target.clone(),
        _ => target.parent().map(Path::to_path_buf).unwrap_or_default(),
    };
    // A folder's Maestro `config.yaml` is sent along but never run as a flow.
    let mut extra: Vec<PathBuf> = Vec::new();
    let mut entries: Vec<PathBuf> = if target.is_dir() {
        let mut flows = Vec::new();
        for p in std::fs::read_dir(&target)?
            .filter_map(Result::ok)
            .map(|e| e.path())
        {
            if !(p.is_file() && is_yaml(&p)) {
                continue;
            }
            if is_config(&p) {
                extra.push(p);
            } else {
                flows.push(p);
            }
        }
        flows
    } else {
        vec![target.clone()]
    };
    entries.sort();
    if entries.is_empty() {
        return Err(AppError::RunnerFailed(
            "no flow to run in this folder".into(),
        ));
    }

    let mut files = BTreeMap::new();
    let mut total = 0usize;
    let mut queue = entries.clone();
    queue.extend(extra);
    while let Some(path) = queue.pop() {
        let rel = relative(&base, &path)?;
        if files.contains_key(&rel) {
            continue;
        }
        let content = std::fs::read_to_string(&path).map_err(|e| {
            AppError::RunnerFailed(format!(
                "{rel} cannot be sent to the farm (text files only): {e}"
            ))
        })?;
        total += content.len();
        if total > MAX_BUNDLE_BYTES {
            return Err(AppError::RunnerFailed(
                "the flow and its files exceed 8 MB".into(),
            ));
        }
        if is_yaml(&path) {
            let dir = path.parent().unwrap_or(&base).to_path_buf();
            for reference in referenced_paths(&content) {
                let dep = normalize(&dir.join(&reference));
                if !dep.starts_with(&base) {
                    return Err(AppError::RunnerFailed(format!(
                        "{rel} refers to {reference}, outside the workspace"
                    )));
                }
                // A missing file is Maestro's to report, with its usual message.
                if dep.is_file() {
                    queue.push(dep);
                }
            }
        }
        files.insert(rel, content);
    }
    let entry = entries
        .iter()
        .map(|p| relative(&base, p))
        .collect::<AppResult<Vec<_>>>()?;
    Ok(FlowBundle { files, entry })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(root: &Path, rel: &str, content: &str) {
        let p = root.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    #[test]
    fn finds_path_values_and_skips_urls_and_blocks() {
        let refs = referenced_paths(
            "appId: a\n---\n- runFlow: ../common/login.yaml\n- runFlow:\n    file: sub.yaml\n\
             - runScript: \"scripts/x.js\" # comment\n- openLink: https://x.y/z\n- inputText: hello\n- runFlow: |\n",
        );
        assert_eq!(
            refs,
            vec!["../common/login.yaml", "sub.yaml", "scripts/x.js"]
        );
    }

    #[test]
    fn collects_the_flow_and_its_dependencies_relative_to_the_root() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(
            root,
            "flows/main.yaml",
            "appId: a\n---\n- runFlow: ../common/login.yaml\n- runScript: s.js\n",
        );
        write(
            root,
            "common/login.yaml",
            "appId: a\n---\n- runFlow: missing.yaml\n",
        );
        write(root, "flows/s.js", "output.x = 1");
        write(root, "unrelated.yaml", "appId: b");
        let b = collect(&root.join("flows/main.yaml"), Some(root)).unwrap();
        assert_eq!(b.entry, vec!["flows/main.yaml"]);
        assert_eq!(
            b.files.keys().cloned().collect::<Vec<_>>(),
            vec!["common/login.yaml", "flows/main.yaml", "flows/s.js"]
        );
    }

    #[test]
    fn a_folder_runs_its_top_level_flows() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "a.yaml", "appId: a");
        write(root, "b.yml", "appId: b");
        write(root, "nested/c.yaml", "appId: c");
        let b = collect(root, Some(root)).unwrap();
        assert_eq!(b.entry, vec!["a.yaml", "b.yml"]);
    }

    #[test]
    fn without_a_root_the_flow_folder_is_the_root() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path(), "x/flow.yaml", "appId: a");
        let b = collect(&dir.path().join("x/flow.yaml"), None).unwrap();
        assert_eq!(b.entry, vec!["flow.yaml"]);
    }

    #[test]
    fn references_outside_the_root_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("ws");
        write(&root, "f.yaml", "- runFlow: ../../etc/passwd\n");
        let err = collect(&root.join("f.yaml"), Some(&root))
            .unwrap_err()
            .to_string();
        assert!(err.contains("outside the workspace"), "{err}");
        write(&root, "g.yaml", "- runScript: /abs/x.js\n");
        assert!(collect(&root.join("g.yaml"), Some(&root)).is_err());
    }

    #[test]
    fn a_folder_run_never_runs_the_maestro_config_but_still_sends_it() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        write(root, "config.yaml", "flows:\n  - \"*\"\n");
        write(root, "a.yaml", "appId: a");
        let b = collect(root, Some(root)).unwrap();
        assert_eq!(b.entry, vec!["a.yaml"]);
        assert!(b.files.contains_key("config.yaml"));
    }
}
