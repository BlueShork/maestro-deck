// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Workspace folder browsing — returns a YAML-only file tree for a directory.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::{AppError, AppResult};

const MAX_DEPTH: usize = 6;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WorkspaceNode {
    Dir {
        name: String,
        path: String,
        children: Vec<WorkspaceNode>,
    },
    File {
        name: String,
        path: String,
    },
}

pub fn list_workspace(root: &Path) -> AppResult<WorkspaceNode> {
    if !root.is_dir() {
        return Err(AppError::Other(format!(
            "{} is not a directory",
            root.display()
        )));
    }
    let name = root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_string();
    let children = scan(root, 0)?;
    Ok(WorkspaceNode::Dir {
        name,
        path: root.to_string_lossy().into_owned(),
        children,
    })
}

fn scan(dir: &Path, depth: usize) -> AppResult<Vec<WorkspaceNode>> {
    if depth >= MAX_DEPTH {
        return Ok(Vec::new());
    }
    let mut dirs: Vec<WorkspaceNode> = Vec::new();
    let mut files: Vec<WorkspaceNode> = Vec::new();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" || name == "target" {
            continue;
        }
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            let children = scan(&path, depth + 1)?;
            dirs.push(WorkspaceNode::Dir {
                name,
                path: path.to_string_lossy().into_owned(),
                children,
            });
        } else if ft.is_file() && is_yaml(&name) {
            files.push(WorkspaceNode::File {
                name,
                path: path.to_string_lossy().into_owned(),
            });
        }
    }

    dirs.sort_by(|a, b| node_name(a).cmp(node_name(b)));
    files.sort_by(|a, b| node_name(a).cmp(node_name(b)));
    dirs.append(&mut files);
    Ok(dirs)
}

fn node_name(n: &WorkspaceNode) -> &str {
    match n {
        WorkspaceNode::Dir { name, .. } | WorkspaceNode::File { name, .. } => name,
    }
}

fn is_yaml(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".yaml") || lower.ends_with(".yml")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn names(children: &[WorkspaceNode]) -> Vec<&str> {
        children.iter().map(node_name).collect()
    }

    #[test]
    fn includes_empty_directories() {
        let tmp = tempdir().unwrap();
        fs::create_dir(tmp.path().join("empty")).unwrap();

        let tree = list_workspace(tmp.path()).unwrap();
        let WorkspaceNode::Dir { children, .. } = tree else {
            panic!("root must be a dir");
        };
        assert_eq!(names(&children), vec!["empty"]);
    }

    #[test]
    fn still_excludes_hidden_node_modules_and_target() {
        let tmp = tempdir().unwrap();
        fs::create_dir(tmp.path().join(".hidden")).unwrap();
        fs::create_dir(tmp.path().join("node_modules")).unwrap();
        fs::create_dir(tmp.path().join("target")).unwrap();
        fs::create_dir(tmp.path().join("keep")).unwrap();

        let tree = list_workspace(tmp.path()).unwrap();
        let WorkspaceNode::Dir { children, .. } = tree else {
            panic!("root must be a dir");
        };
        assert_eq!(names(&children), vec!["keep"]);
    }

    #[test]
    fn dirs_sorted_before_files() {
        let tmp = tempdir().unwrap();
        fs::create_dir(tmp.path().join("zzz_dir")).unwrap();
        fs::write(tmp.path().join("aaa.yaml"), "appId: x").unwrap();

        let tree = list_workspace(tmp.path()).unwrap();
        let WorkspaceNode::Dir { children, .. } = tree else {
            panic!("root must be a dir");
        };
        assert_eq!(names(&children), vec!["zzz_dir", "aaa.yaml"]);
    }
}
