// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Installed plugins on disk: `<root>/installed.json` plus one folder per id.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::manifest::{self, Manifest};

const MAX_UNCOMPRESSED: u64 = 50 * 1024 * 1024;
const MAX_ENTRIES: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledEntry {
    pub id: String,
    pub version: String,
    pub installed_at: u64,
    /// Dev mode: served from this folder instead of `<root>/<id>`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dev_path: Option<String>,
}

/// The registry fields an install needs.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPin {
    pub id: String,
    pub version: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub version: String,
    pub dev: bool,
    pub manifest: Option<Manifest>,
    pub error: Option<String>,
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn read_installed(root: &Path) -> Vec<InstalledEntry> {
    fs::read(root.join("installed.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

fn write_installed(root: &Path, entries: &[InstalledEntry]) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| format!("cannot create plugins folder: {e}"))?;
    let tmp = root.join("installed.json.tmp");
    let json = serde_json::to_vec_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(&tmp, json).map_err(|e| format!("cannot write installed.json: {e}"))?;
    fs::rename(&tmp, root.join("installed.json"))
        .map_err(|e| format!("cannot write installed.json: {e}"))
}

fn upsert(root: &Path, entry: InstalledEntry) -> Result<(), String> {
    let mut entries: Vec<_> = read_installed(root)
        .into_iter()
        .filter(|e| e.id != entry.id)
        .collect();
    entries.push(entry);
    write_installed(root, &entries)
}

pub fn plugin_dir(root: &Path, entry: &InstalledEntry) -> PathBuf {
    entry
        .dev_path
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| root.join(&entry.id))
}

pub fn load_manifest(dir: &Path) -> Result<Manifest, String> {
    let bytes = fs::read(dir.join("manifest.json"))
        .map_err(|e| format!("manifest.json unreadable: {e}"))?;
    let m: Manifest =
        serde_json::from_slice(&bytes).map_err(|e| format!("manifest.json invalid: {e}"))?;
    manifest::validate(&m)?;
    if !dir.join(&m.entry).is_file() {
        return Err(format!("entry file missing: {}", m.entry));
    }
    Ok(m)
}

/// The manifest of an installed plugin, read fresh from disk.
pub fn installed_manifest(root: &Path, id: &str) -> Result<Manifest, String> {
    let entry = read_installed(root)
        .into_iter()
        .find(|e| e.id == id)
        .ok_or_else(|| format!("forbidden: plugin {id} is not installed"))?;
    entry_manifest(root, &entry)
}

/// The entry's manifest, which must still name the entry: an edited manifest or
/// a dev folder rebuilt under another id would otherwise run with that other
/// plugin's id, and so with its secrets.
fn entry_manifest(root: &Path, entry: &InstalledEntry) -> Result<Manifest, String> {
    let m = load_manifest(&plugin_dir(root, entry))?;
    if m.id != entry.id {
        return Err(format!(
            "manifest.json declares id {} but the plugin is installed as {}",
            m.id, entry.id
        ));
    }
    Ok(m)
}

/// Plugins loaded from a local folder in a debug build skip the check, so a
/// plugin targeting the next release can be developed against this one.
fn check_compat(m: &Manifest, app_version: &str, dev: bool) -> Result<(), String> {
    if (dev && cfg!(debug_assertions))
        || manifest::version_at_least(app_version, &m.min_app_version)
    {
        Ok(())
    } else {
        Err(format!(
            "requires Maestro Deck {} or later",
            m.min_app_version
        ))
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|e| format!("plugin.zip unreadable: {e}"))?;
    if zip.len() > MAX_ENTRIES {
        return Err("plugin.zip has too many files".into());
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut budget = MAX_UNCOMPRESSED;
    for i in 0..zip.len() {
        let mut file = zip
            .by_index(i)
            .map_err(|e| format!("plugin.zip entry {i}: {e}"))?;
        if file.is_symlink() {
            return Err(format!("plugin.zip contains a symlink: {}", file.name()));
        }
        let Some(rel) = file.enclosed_name() else {
            return Err(format!("unsafe path in plugin.zip: {}", file.name()));
        };
        let out = dest.join(rel);
        if file.is_dir() {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut w = fs::File::create(&out).map_err(|e| e.to_string())?;
        let copied = std::io::copy(&mut file.by_ref().take(budget + 1), &mut w)
            .map_err(|e| e.to_string())?;
        if copied > budget {
            return Err("plugin.zip is too large once extracted".into());
        }
        budget -= copied;
    }
    Ok(())
}

pub fn install_bytes(
    root: &Path,
    pin: &RegistryPin,
    bytes: &[u8],
    app_version: &str,
) -> Result<Manifest, String> {
    if !manifest::valid_id(&pin.id) {
        return Err(format!("invalid plugin id: {:?}", pin.id));
    }
    if sha256_hex(bytes) != pin.sha256.to_ascii_lowercase() {
        return Err("download does not match the registry checksum".into());
    }
    fs::create_dir_all(root).map_err(|e| format!("cannot create plugins folder: {e}"))?;
    let tmp = root.join(format!(".tmp-{}-{}", pin.id, now_millis()));
    let checked = extract_zip(bytes, &tmp).and_then(|()| {
        let m = load_manifest(&tmp)?;
        if m.id != pin.id || m.version != pin.version {
            return Err(format!(
                "plugin.zip is {} {}, registry expects {} {}",
                m.id, m.version, pin.id, pin.version
            ));
        }
        check_compat(&m, app_version, false)?;
        Ok(m)
    });
    let m = match checked {
        Ok(m) => m,
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp);
            return Err(e);
        }
    };
    let dest = root.join(&pin.id);
    if dest.exists() {
        if let Err(e) = fs::remove_dir_all(&dest) {
            let _ = fs::remove_dir_all(&tmp);
            return Err(format!("cannot replace the installed version: {e}"));
        }
    }
    if let Err(e) = fs::rename(&tmp, &dest) {
        let _ = fs::remove_dir_all(&tmp);
        return Err(format!("cannot move plugin into place: {e}"));
    }
    upsert(
        root,
        InstalledEntry {
            id: m.id.clone(),
            version: m.version.clone(),
            installed_at: now_millis(),
            dev_path: None,
        },
    )?;
    Ok(m)
}

pub fn register_dev(root: &Path, dir: &Path, app_version: &str) -> Result<Manifest, String> {
    let dir = dir
        .canonicalize()
        .map_err(|e| format!("cannot open folder: {e}"))?;
    let m = load_manifest(&dir)?;
    check_compat(&m, app_version, true)?;
    upsert(
        root,
        InstalledEntry {
            id: m.id.clone(),
            version: m.version.clone(),
            installed_at: now_millis(),
            dev_path: Some(dir.to_string_lossy().into_owned()),
        },
    )?;
    Ok(m)
}

pub fn uninstall(root: &Path, id: &str) -> Result<(), String> {
    if !manifest::valid_id(id) {
        return Err(format!("invalid plugin id: {id:?}"));
    }
    let entries = read_installed(root);
    let Some(entry) = entries.iter().find(|e| e.id == id) else {
        return Ok(());
    };
    if entry.dev_path.is_none() {
        let dir = root.join(id);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove plugin files: {e}"))?;
        }
    }
    let rest: Vec<_> = entries.into_iter().filter(|e| e.id != id).collect();
    write_installed(root, &rest)
}

pub fn list(root: &Path, app_version: &str) -> Vec<InstalledPlugin> {
    read_installed(root)
        .into_iter()
        .map(|e| {
            let loaded = entry_manifest(root, &e)
                .and_then(|m| check_compat(&m, app_version, e.dev_path.is_some()).map(|()| m));
            let (manifest, error) = match loaded {
                Ok(m) => (Some(m), None),
                Err(err) => (None, Some(err)),
            };
            InstalledPlugin {
                id: e.id,
                version: e.version,
                dev: e.dev_path.is_some(),
                manifest,
                error,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use zip::write::SimpleFileOptions;

    const MANIFEST: &str = r#"{"id":"jira","name":"Jira","version":"1.0.0","minAppVersion":"1.1.0","entry":"index.html"}"#;

    fn make_zip(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        for (name, data) in files {
            w.start_file(*name, SimpleFileOptions::default()).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    fn good_zip() -> Vec<u8> {
        make_zip(&[
            ("manifest.json", MANIFEST.as_bytes()),
            ("index.html", b"<p>hi</p>"),
            ("assets/app.js", b"1"),
        ])
    }

    fn pin_for(bytes: &[u8]) -> RegistryPin {
        RegistryPin {
            id: "jira".into(),
            version: "1.0.0".into(),
            url: "https://x/plugin.zip".into(),
            sha256: sha256_hex(bytes),
        }
    }

    fn no_tmp_left(root: &Path) -> bool {
        std::fs::read_dir(root).unwrap().all(|e| {
            !e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".tmp-")
        })
    }

    #[test]
    fn installs_and_lists() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        let m = install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap();
        assert_eq!(m.id, "jira");
        assert!(root.path().join("jira/assets/app.js").is_file());
        let listed = list(root.path(), "1.1.0");
        assert_eq!(listed.len(), 1);
        assert!(listed[0].manifest.is_some() && listed[0].error.is_none() && !listed[0].dev);
        assert!(no_tmp_left(root.path()));
    }

    #[test]
    fn rejects_checksum_mismatch() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        let mut pin = pin_for(&zip);
        pin.sha256 = "00".repeat(32);
        let err = install_bytes(root.path(), &pin, &zip, "1.1.0").unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!root.path().join("jira").exists());
    }

    #[test]
    fn checksum_is_case_insensitive() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        let mut pin = pin_for(&zip);
        pin.sha256 = pin.sha256.to_uppercase();
        assert!(install_bytes(root.path(), &pin, &zip, "1.1.0").is_ok());
    }

    #[test]
    fn rejects_zip_slip() {
        let root = tempfile::tempdir().unwrap();
        let zip = make_zip(&[
            ("manifest.json", MANIFEST.as_bytes()),
            ("index.html", b"x"),
            ("../evil.txt", b"x"),
        ]);
        let err = install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap_err();
        assert!(err.contains("unsafe path"), "{err}");
        assert!(!root.path().join("evil.txt").exists());
        assert!(no_tmp_left(root.path()));
    }

    #[test]
    fn rejects_symlinks() {
        let root = tempfile::tempdir().unwrap();
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        w.start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        w.write_all(MANIFEST.as_bytes()).unwrap();
        w.add_symlink("index.html", "/etc/passwd", SimpleFileOptions::default())
            .unwrap();
        let zip = w.finish().unwrap().into_inner();
        let err = install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap_err();
        assert!(err.contains("symlink"), "{err}");
    }

    #[test]
    fn rejects_id_or_version_mismatch() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        let mut pin = pin_for(&zip);
        pin.version = "2.0.0".into();
        assert!(install_bytes(root.path(), &pin, &zip, "1.1.0")
            .unwrap_err()
            .contains("registry expects"));
    }

    #[test]
    fn rejects_too_old_app() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        let err = install_bytes(root.path(), &pin_for(&zip), &zip, "1.0.0").unwrap_err();
        assert!(err.contains("requires Maestro Deck 1.1.0"), "{err}");
    }

    #[test]
    fn reinstall_replaces_files() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap();
        let m2 = MANIFEST.replace("1.0.0", "1.0.1");
        let zip2 = make_zip(&[("manifest.json", m2.as_bytes()), ("index.html", b"v2")]);
        let mut pin = pin_for(&zip2);
        pin.version = "1.0.1".into();
        install_bytes(root.path(), &pin, &zip2, "1.1.0").unwrap();
        assert!(!root.path().join("jira/assets/app.js").exists());
        assert_eq!(read_installed(root.path()).len(), 1);
        assert_eq!(read_installed(root.path())[0].version, "1.0.1");
    }

    #[test]
    fn uninstall_removes_dir_and_entry() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap();
        uninstall(root.path(), "jira").unwrap();
        assert!(!root.path().join("jira").exists());
        assert!(read_installed(root.path()).is_empty());
        uninstall(root.path(), "jira").unwrap(); // idempotent
    }

    #[test]
    fn broken_manifest_is_listed_with_error() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap();
        std::fs::write(root.path().join("jira/manifest.json"), "{").unwrap();
        let listed = list(root.path(), "1.1.0");
        assert!(listed[0].manifest.is_none());
        assert!(listed[0]
            .error
            .as_deref()
            .unwrap()
            .contains("manifest.json invalid"));
    }

    #[test]
    fn manifest_id_must_match_the_installed_entry() {
        let root = tempfile::tempdir().unwrap();
        let zip = good_zip();
        install_bytes(root.path(), &pin_for(&zip), &zip, "1.1.0").unwrap();
        let swapped = MANIFEST.replace(r#""id":"jira""#, r#""id":"linear""#);
        std::fs::write(root.path().join("jira/manifest.json"), swapped).unwrap();
        let listed = list(root.path(), "1.1.0");
        assert!(listed[0].manifest.is_none());
        assert!(listed[0].error.as_deref().unwrap().contains("linear"));
        assert!(installed_manifest(root.path(), "jira").is_err());
    }

    #[test]
    fn dev_plugins_skip_min_app_version_in_debug_builds() {
        let root = tempfile::tempdir().unwrap();
        let dev = tempfile::tempdir().unwrap();
        std::fs::write(
            dev.path().join("manifest.json"),
            r#"{"id":"github","name":"GitHub","version":"1.0.0","minAppVersion":"9.0.0","entry":"index.html"}"#,
        )
        .unwrap();
        std::fs::write(dev.path().join("index.html"), "x").unwrap();
        // Tests build with debug assertions, like `tauri dev`.
        register_dev(root.path(), dev.path(), "1.1.0").unwrap();
        let listed = list(root.path(), "1.1.0");
        assert!(listed[0].manifest.is_some() && listed[0].error.is_none());
    }

    #[test]
    fn installed_plugins_still_need_min_app_version() {
        let root = tempfile::tempdir().unwrap();
        let m = MANIFEST.replace("\"minAppVersion\":\"1.1.0\"", "\"minAppVersion\":\"9.0.0\"");
        let zip = make_zip(&[("manifest.json", m.as_bytes()), ("index.html", b"x")]);
        let pin = RegistryPin {
            id: "jira".into(),
            version: "1.0.0".into(),
            url: "https://example.com/p.zip".into(),
            sha256: sha256_hex(&zip),
        };
        assert!(install_bytes(root.path(), &pin, &zip, "1.1.0")
            .unwrap_err()
            .contains("requires Maestro Deck 9.0.0"));
    }

    #[test]
    fn dev_plugins_are_served_from_their_folder_and_never_deleted() {
        let root = tempfile::tempdir().unwrap();
        let dev = tempfile::tempdir().unwrap();
        std::fs::write(dev.path().join("manifest.json"), MANIFEST).unwrap();
        std::fs::write(dev.path().join("index.html"), "x").unwrap();
        register_dev(root.path(), dev.path(), "1.1.0").unwrap();
        let listed = list(root.path(), "1.1.0");
        assert!(listed[0].dev && listed[0].manifest.is_some());
        uninstall(root.path(), "jira").unwrap();
        assert!(dev.path().join("index.html").exists());
    }
}
