// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Plugin secrets in the OS keychain, one entry per `plugin:<id>:<key>`.
//!
//! The keychain cannot be listed by prefix portably, so `secret-index.json`
//! records which keys each plugin wrote; uninstall walks it to clean up.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use crate::credentials::{delete_payload, read_payload, write_payload};

type Index = BTreeMap<String, Vec<String>>;

pub fn account(id: &str, key: &str) -> String {
    format!("plugin:{id}:{key}")
}

fn read_index(root: &Path) -> Index {
    fs::read(root.join("secret-index.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_index(root: &Path, index: &Index) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    fs::write(
        root.join("secret-index.json"),
        serde_json::to_vec_pretty(index).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("cannot write secret index: {e}"))
}

pub fn index_add(root: &Path, id: &str, key: &str) -> Result<(), String> {
    let mut index = read_index(root);
    let keys = index.entry(id.to_string()).or_default();
    if !keys.iter().any(|k| k == key) {
        keys.push(key.to_string());
    }
    write_index(root, &index)
}

pub fn index_remove(root: &Path, id: &str, key: &str) -> Result<(), String> {
    let mut index = read_index(root);
    if let Some(keys) = index.get_mut(id) {
        keys.retain(|k| k != key);
        if keys.is_empty() {
            index.remove(id);
        }
    }
    write_index(root, &index)
}

pub fn index_take_all(root: &Path, id: &str) -> Result<Vec<String>, String> {
    let mut index = read_index(root);
    let keys = index.remove(id).unwrap_or_default();
    write_index(root, &index)?;
    Ok(keys)
}

pub fn get(id: &str, key: &str) -> Result<Option<String>, String> {
    read_payload(&account(id, key))
}

pub fn set(root: &Path, id: &str, key: &str, value: &str) -> Result<(), String> {
    write_payload(&account(id, key), value)?;
    index_add(root, id, key)
}

pub fn delete(root: &Path, id: &str, key: &str) -> Result<(), String> {
    delete_payload(&account(id, key))?;
    index_remove(root, id, key)
}

/// Best effort: a keychain error on one key must not block uninstalling.
pub fn delete_all(root: &Path, id: &str) {
    for key in index_take_all(root, id).unwrap_or_default() {
        let _ = delete_payload(&account(id, &key));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn index_tracks_keys_per_plugin() {
        let root = tempfile::tempdir().unwrap();
        index_add(root.path(), "jira", "credentials").unwrap();
        index_add(root.path(), "jira", "credentials").unwrap();
        index_add(root.path(), "jira", "other").unwrap();
        index_add(root.path(), "linear", "token").unwrap();
        index_remove(root.path(), "jira", "other").unwrap();
        assert_eq!(
            index_take_all(root.path(), "jira").unwrap(),
            vec!["credentials".to_string()]
        );
        assert!(index_take_all(root.path(), "jira").unwrap().is_empty());
        assert_eq!(
            index_take_all(root.path(), "linear").unwrap(),
            vec!["token".to_string()]
        );
    }

    #[test]
    fn account_names() {
        assert_eq!(account("jira", "credentials"), "plugin:jira:credentials");
    }
}
