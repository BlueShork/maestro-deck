// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Origins the user allowed a plugin to reach beyond its manifest, in
//! `<root>/grants.json` as `{ "<plugin id>": ["https://host[:port]", …] }`.
//! Only the host writes here, after the user confirmed in a dialog.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use super::manifest::normalize_origin;

type Grants = BTreeMap<String, Vec<String>>;

const FILE: &str = "grants.json";

fn read(root: &Path) -> Grants {
    fs::read(root.join(FILE))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write(root: &Path, g: &Grants) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("cannot create plugins folder: {e}"))?;
    let tmp = root.join(format!("{FILE}.tmp"));
    let bytes = serde_json::to_vec_pretty(g).map_err(|e| e.to_string())?;
    fs::write(&tmp, bytes).map_err(|e| format!("cannot save grants: {e}"))?;
    fs::rename(&tmp, root.join(FILE)).map_err(|e| format!("cannot save grants: {e}"))
}

pub fn granted(root: &Path, id: &str) -> Vec<String> {
    read(root).remove(id).unwrap_or_default()
}

/// Grants `origin` to plugin `id`; returns the normalised origin.
pub fn grant(root: &Path, id: &str, origin: &str) -> Result<String, String> {
    let o = normalize_origin(origin)
        .ok_or_else(|| format!("bad_request: {origin:?} is not an https origin"))?;
    let mut g = read(root);
    let list = g.entry(id.to_string()).or_default();
    if !list.contains(&o) {
        list.push(o.clone());
        write(root, &g)?;
    }
    Ok(o)
}

pub fn revoke(root: &Path, id: &str, origin: &str) -> Result<(), String> {
    let Some(o) = normalize_origin(origin) else {
        return Ok(());
    };
    let mut g = read(root);
    if let Some(list) = g.get_mut(id) {
        list.retain(|x| *x != o);
        if list.is_empty() {
            g.remove(id);
        }
        write(root, &g)?;
    }
    Ok(())
}

pub fn remove_plugin(root: &Path, id: &str) -> Result<(), String> {
    let mut g = read(root);
    if g.remove(id).is_some() {
        write(root, &g)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grant_list_revoke_and_remove() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        assert!(granted(root, "gitlab").is_empty());
        assert_eq!(
            grant(root, "gitlab", "https://GitLab.Acme.fr/").unwrap(),
            "https://gitlab.acme.fr"
        );
        grant(root, "gitlab", "https://gitlab.acme.fr").unwrap();
        grant(root, "gitlab", "https://git.other.io:8443").unwrap();
        assert_eq!(
            granted(root, "gitlab"),
            vec!["https://gitlab.acme.fr", "https://git.other.io:8443"]
        );
        assert!(granted(root, "jira").is_empty());
        revoke(root, "gitlab", "https://gitlab.acme.fr").unwrap();
        assert_eq!(granted(root, "gitlab"), vec!["https://git.other.io:8443"]);
        remove_plugin(root, "gitlab").unwrap();
        assert!(granted(root, "gitlab").is_empty());
    }

    #[test]
    fn rejects_bad_origins() {
        let d = tempfile::tempdir().unwrap();
        assert!(grant(d.path(), "gitlab", "http://x.fr")
            .unwrap_err()
            .starts_with("bad_request:"));
        assert!(grant(d.path(), "gitlab", "https://x.fr/path").is_err());
    }
}
