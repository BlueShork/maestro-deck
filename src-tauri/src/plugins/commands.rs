// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Tauri commands for the plugin catalogue and the plugin host API.
//!
//! Every per-plugin command takes the plugin id and re-reads its manifest from
//! disk: the webview says which plugin is asking, Rust decides what it may do.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

use super::http::{self, HttpRequest, HttpResponse};
use super::manifest::{origin_allowed, valid_id, valid_key, Manifest};
use super::store::{self, InstalledPlugin, RegistryPin};
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
    let m = manifest_for(&root()?, &plugin_id)?;
    http::fetch(m.permissions.http, request).await
}

#[tauri::command]
pub async fn plugin_open_external(
    app: AppHandle,
    plugin_id: String,
    url: String,
) -> Result<(), String> {
    let m = manifest_for(&root()?, &plugin_id)?;
    let allowed: Vec<String> = m
        .permissions
        .http
        .iter()
        .chain(&m.permissions.open)
        .cloned()
        .collect();
    if !origin_allowed(&allowed, &url) {
        return Err(format!(
            "forbidden: {url} is not allowed by this plugin's permissions"
        ));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
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
