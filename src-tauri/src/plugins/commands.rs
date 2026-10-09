// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Tauri commands for the plugin catalogue and the plugin host API.
//!
//! Every per-plugin command takes the plugin id and re-reads its manifest from
//! disk: the webview says which plugin is asking, Rust decides what it may do.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine as _;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::grants;
use super::http::{self, HttpRequest, HttpResponse};
use super::manifest::{normalize_origin, valid_id, valid_key, Allow, Manifest};
use super::store::{self, InstalledPlugin, RegistryPin};
use super::workspace::{self, Change, Status, WorkspaceInfo};
use super::{plugins_root, secrets, APP_VERSION, REGISTRY_URL};

const DOWNLOAD_CAP: usize = 20 * 1024 * 1024;
const REGISTRY_CAP: usize = 1024 * 1024;

fn root() -> Result<PathBuf, String> {
    plugins_root().ok_or_else(|| "cannot locate the app data folder".to_string())
}

fn manifest_for(root: &Path, plugin_id: &str) -> Result<Manifest, String> {
    if !valid_id(plugin_id) {
        return Err(format!("forbidden: invalid plugin id {plugin_id:?}"));
    }
    store::installed_manifest(root, plugin_id)
}

fn secret_manifest(root: &Path, plugin_id: &str, key: &str) -> Result<(), String> {
    let m = manifest_for(root, plugin_id)?;
    if !m.permissions.secrets {
        return Err("forbidden: this plugin did not request secret storage".into());
    }
    if !valid_key(key) {
        return Err(format!("bad_request: invalid key {key:?}"));
    }
    Ok(())
}

/// What `m` may reach: manifest patterns plus, when it asked for them, the
/// origins its user granted.
fn allow_for(root: &Path, m: &Manifest) -> Allow {
    Allow {
        patterns: m.permissions.http.clone(),
        origins: if m.permissions.user_origins {
            grants::granted(root, &m.id)
        } else {
            Vec::new()
        },
    }
}

fn require_user_origins(m: &Manifest) -> Result<(), String> {
    if m.permissions.user_origins {
        Ok(())
    } else {
        Err("forbidden: this plugin did not request user-granted origins".into())
    }
}

async fn download(url: &str, cap: usize, timeout: Duration) -> Result<Vec<u8>, String> {
    let res = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| format!("network: {e}"))?
        .get(url)
        .send()
        .await
        .map_err(http::send_error)?;
    if !res.status().is_success() {
        return Err(format!("network: {url} answered HTTP {}", res.status()));
    }
    http::read_capped(res, cap).await
}

#[tauri::command]
pub async fn plugins_registry() -> Result<String, String> {
    let bytes = download(REGISTRY_URL, REGISTRY_CAP, Duration::from_secs(15)).await?;
    String::from_utf8(bytes).map_err(|_| "registry is not valid UTF-8".to_string())
}

#[tauri::command]
pub async fn plugins_list() -> Result<Vec<InstalledPlugin>, String> {
    let root = root()?;
    tokio::task::spawn_blocking(move || store::list(&root, APP_VERSION))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn plugins_install(pin: RegistryPin) -> Result<Manifest, String> {
    if !pin.url.starts_with("https://") {
        return Err("bad_request: plugin downloads must use https".into());
    }
    let bytes = download(&pin.url, DOWNLOAD_CAP, Duration::from_secs(60)).await?;
    let root = root()?;
    tokio::task::spawn_blocking(move || store::install_bytes(&root, &pin, &bytes, APP_VERSION))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugins_uninstall(id: String) -> Result<(), String> {
    let root = root()?;
    tokio::task::spawn_blocking(move || {
        secrets::delete_all(&root, &id);
        grants::remove_plugin(&root, &id)?;
        store::uninstall(&root, &id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugins_load_dev(path: String) -> Result<Manifest, String> {
    if !cfg!(debug_assertions) {
        return Err("forbidden: local plugins are only available in development builds".into());
    }
    let root = root()?;
    tokio::task::spawn_blocking(move || store::register_dev(&root, Path::new(&path), APP_VERSION))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_http_fetch(
    plugin_id: String,
    request: HttpRequest,
) -> Result<HttpResponse, String> {
    let root = root()?;
    let m = manifest_for(&root, &plugin_id)?;
    http::fetch(allow_for(&root, &m), request).await
}

#[tauri::command]
pub async fn plugin_open_external(
    app: AppHandle,
    plugin_id: String,
    url: String,
) -> Result<(), String> {
    let root = root()?;
    let m = manifest_for(&root, &plugin_id)?;
    let mut allow = allow_for(&root, &m);
    allow.patterns.extend(m.permissions.open.iter().cloned());
    if !allow.allows(&url) {
        return Err(format!(
            "forbidden: {url} is not allowed by this plugin's permissions"
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

/// Whether `origin` is already reachable (manifest or grant): the bridge only
/// shows the grant dialog when it is not.
#[tauri::command]
pub async fn plugin_origin_allowed(plugin_id: String, origin: String) -> Result<bool, String> {
    let root = root()?;
    let m = manifest_for(&root, &plugin_id)?;
    require_user_origins(&m)?;
    let o = normalize_origin(&origin)
        .ok_or_else(|| format!("bad_request: {origin:?} is not an https origin"))?;
    Ok(allow_for(&root, &m).allows(&o))
}

/// Called by the app after the user clicked Allow — never routed from a
/// plugin RPC.
#[tauri::command]
pub async fn plugin_grant_origin(plugin_id: String, origin: String) -> Result<String, String> {
    let root = root()?;
    require_user_origins(&manifest_for(&root, &plugin_id)?)?;
    grants::grant(&root, &plugin_id, &origin)
}

#[tauri::command]
pub async fn plugin_revoke_origin(plugin_id: String, origin: String) -> Result<(), String> {
    if !valid_id(&plugin_id) {
        return Err(format!("forbidden: invalid plugin id {plugin_id:?}"));
    }
    grants::revoke(&root()?, &plugin_id, &origin)
}

#[tauri::command]
pub async fn plugin_secret_get(plugin_id: String, key: String) -> Result<Option<String>, String> {
    secret_manifest(&root()?, &plugin_id, &key)?;
    secrets::get(&plugin_id, &key)
}

#[tauri::command]
pub async fn plugin_secret_set(
    plugin_id: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let root = root()?;
    secret_manifest(&root, &plugin_id, &key)?;
    secrets::set(&root, &plugin_id, &key, &value)
}

#[tauri::command]
pub async fn plugin_secret_delete(plugin_id: String, key: String) -> Result<(), String> {
    let root = root()?;
    secret_manifest(&root, &plugin_id, &key)?;
    secrets::delete(&root, &plugin_id, &key)
}

/// Paths each plugin may read: the added and modified files from its latest
/// `workspace.changes` for that root. A new folder or a new listing replaces
/// it, so a plugin can only send what it just showed the QA.
#[derive(Default)]
pub struct WorkspaceAllow(parking_lot::Mutex<HashMap<(String, PathBuf), HashSet<String>>>);

impl WorkspaceAllow {
    fn replace(&self, plugin_id: &str, root: &Path, paths: HashSet<String>) {
        self.0
            .lock()
            .insert((plugin_id.to_string(), root.to_path_buf()), paths);
    }

    fn get(&self, plugin_id: &str, root: &Path) -> HashSet<String> {
        self.0
            .lock()
            .get(&(plugin_id.to_string(), root.to_path_buf()))
            .cloned()
            .unwrap_or_default()
    }
}

fn require_workspace(m: &Manifest) -> Result<(), String> {
    if m.permissions.workspace {
        Ok(())
    } else {
        Err("forbidden: this plugin did not request workspace access".into())
    }
}

fn readable(files: &[Change]) -> HashSet<String> {
    files
        .iter()
        .filter(|c| c.status != Status::Deleted)
        .map(|c| c.path.clone())
        .collect()
}

#[tauri::command]
pub async fn plugin_workspace_info(
    plugin_id: String,
    workspace: Option<String>,
) -> Result<Option<WorkspaceInfo>, String> {
    require_workspace(&manifest_for(&root()?, &plugin_id)?)?;
    let Some(ws) = workspace else {
        return Ok(None);
    };
    tokio::task::spawn_blocking(move || workspace::info(Path::new(&ws)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn plugin_workspace_changes(
    allow: tauri::State<'_, WorkspaceAllow>,
    plugin_id: String,
    workspace: String,
) -> Result<Vec<Change>, String> {
    require_workspace(&manifest_for(&root()?, &plugin_id)?)?;
    let ws = PathBuf::from(&workspace);
    let dir = ws.clone();
    let files = tokio::task::spawn_blocking(move || workspace::changes(&dir))
        .await
        .map_err(|e| e.to_string())?;
    // A failed listing clears the allowlist too: nothing stale stays readable.
    allow.replace(
        &plugin_id,
        &ws,
        files.as_deref().map(readable).unwrap_or_default(),
    );
    files
}

#[tauri::command]
pub async fn plugin_workspace_read(
    allow: tauri::State<'_, WorkspaceAllow>,
    plugin_id: String,
    workspace: String,
    path: String,
) -> Result<String, String> {
    require_workspace(&manifest_for(&root()?, &plugin_id)?)?;
    let ws = PathBuf::from(&workspace);
    let allowed = allow.get(&plugin_id, &ws);
    let bytes = tokio::task::spawn_blocking(move || workspace::read_file(&ws, &path, &allowed))
        .await
        .map_err(|e| e.to_string())??;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Network: installs every plugin of the live registry into a temp dir.
    /// Run with `cargo test --lib plugins::commands -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_registry_installs() {
        #[derive(serde::Deserialize)]
        struct Doc {
            plugins: Vec<RegistryPin>,
        }
        let doc: Doc = serde_json::from_str(&plugins_registry().await.unwrap()).unwrap();
        assert!(!doc.plugins.is_empty());
        let root = tempfile::tempdir().unwrap();
        for pin in doc.plugins {
            let bytes = download(&pin.url, DOWNLOAD_CAP, Duration::from_secs(60))
                .await
                .unwrap();
            let m = store::install_bytes(root.path(), &pin, &bytes, APP_VERSION).unwrap();
            assert_eq!(m.id, pin.id);
        }
        assert!(store::list(root.path(), APP_VERSION)
            .iter()
            .all(|p| p.error.is_none()));
    }
}

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn allowlist_is_per_plugin_and_per_root() {
        let allow = WorkspaceAllow::default();
        allow.replace("github", Path::new("/a"), ["x.yaml".to_string()].into());
        assert!(allow.get("github", Path::new("/a")).contains("x.yaml"));
        assert!(allow.get("github", Path::new("/b")).is_empty());
        assert!(allow.get("jira", Path::new("/a")).is_empty());
        allow.replace("github", Path::new("/a"), HashSet::new());
        assert!(allow.get("github", Path::new("/a")).is_empty());
    }

    #[test]
    fn workspace_needs_the_permission() {
        let mut m: Manifest = serde_json::from_str(
            r#"{"id":"github","name":"G","version":"1.0.0","minAppVersion":"1.2.0","entry":"index.html"}"#,
        )
        .unwrap();
        assert!(require_workspace(&m).unwrap_err().starts_with("forbidden:"));
        m.permissions.workspace = true;
        assert!(require_workspace(&m).is_ok());
    }

    #[test]
    fn readable_paths_exclude_deletions() {
        let c = |p: &str, status| Change {
            path: p.into(),
            status,
            size: 0,
            executable: false,
        };
        let set = readable(&[
            c("a", Status::Added),
            c("m", Status::Modified),
            c("d", Status::Deleted),
        ]);
        assert_eq!(set, HashSet::from(["a".to_string(), "m".to_string()]));
    }
}
