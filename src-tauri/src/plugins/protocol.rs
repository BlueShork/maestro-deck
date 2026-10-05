// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! The `mdplugin` URI scheme: serves an installed plugin's files to its iframe.
//!
//! Every response carries a CSP that forbids network access, so the plugin's
//! only way out is the host RPC. `Access-Control-Allow-Origin: *` is required
//! because the sandboxed frame has an opaque origin and Vite emits module
//! scripts, which are fetched in CORS mode.

use std::path::{Path, PathBuf};

use tauri::http::{header, Response, StatusCode};

use super::manifest::{safe_relative, valid_id};
use super::store::{plugin_dir, read_installed};

pub const PLUGIN_CSP: &str = "default-src 'none'; script-src mdplugin: http://mdplugin.localhost; style-src mdplugin: http://mdplugin.localhost 'unsafe-inline'; img-src mdplugin: http://mdplugin.localhost data: https:; font-src mdplugin: http://mdplugin.localhost data:; connect-src 'none'; form-action 'none'";

pub fn resolve(root: &Path, uri_path: &str) -> Option<PathBuf> {
    let path = uri_path.strip_prefix('/')?;
    if path.contains('%') {
        return None;
    }
    let (id, rest) = path.split_once('/')?;
    if !valid_id(id) || !safe_relative(rest) {
        return None;
    }
    let entry = read_installed(root).into_iter().find(|e| e.id == id)?;
    let dir = plugin_dir(root, &entry).canonicalize().ok()?;
    let file = dir.join(rest).canonicalize().ok()?;
    (file.starts_with(&dir) && file.is_file()).then_some(file)
}

pub fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn not_found() -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::NOT_FOUND)
        .body(Vec::new())
        .expect("static response")
}

pub fn respond(uri_path: &str) -> Response<Vec<u8>> {
    let Some(root) = super::plugins_root() else {
        return not_found();
    };
    let Some(file) = resolve(&root, uri_path) else {
        return not_found();
    };
    let Ok(body) = std::fs::read(&file) else {
        return not_found();
    };
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, mime_for(&file))
        .header("Content-Security-Policy", PLUGIN_CSP)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header("X-Content-Type-Options", "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body)
        .expect("static response")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("jira/assets")).unwrap();
        std::fs::write(root.path().join("jira/index.html"), "x").unwrap();
        std::fs::write(root.path().join("jira/assets/app.js"), "x").unwrap();
        std::fs::write(root.path().join("secret.txt"), "x").unwrap();
        std::fs::write(
            root.path().join("installed.json"),
            r#"[{"id":"jira","version":"1.0.0","installedAt":0}]"#,
        )
        .unwrap();
        root
    }

    #[test]
    fn resolves_files_inside_the_plugin() {
        let root = setup();
        assert!(resolve(root.path(), "/jira/index.html").is_some());
        assert!(resolve(root.path(), "/jira/assets/app.js").is_some());
    }

    #[test]
    fn refuses_escapes_and_unknowns() {
        let root = setup();
        assert!(resolve(root.path(), "/jira/../secret.txt").is_none());
        assert!(resolve(root.path(), "/jira/%2e%2e/secret.txt").is_none());
        assert!(resolve(root.path(), "/jira/").is_none());
        assert!(resolve(root.path(), "/jira/assets").is_none());
        assert!(resolve(root.path(), "/linear/index.html").is_none());
        assert!(resolve(root.path(), "/../secret.txt").is_none());
        assert!(resolve(root.path(), "/jira/missing.js").is_none());
    }

    #[test]
    fn mime_types() {
        assert_eq!(mime_for(Path::new("a.html")), "text/html; charset=utf-8");
        assert_eq!(
            mime_for(Path::new("a.js")),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(mime_for(Path::new("a.svg")), "image/svg+xml");
        assert_eq!(mime_for(Path::new("a.bin")), "application/octet-stream");
    }
}
