// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Plugins: first-party panels installed from a curated registry.
//!
//! Rust owns every privileged step — download, checksum, extraction, file
//! serving, and the network/keychain calls a plugin makes — and re-checks the
//! plugin's manifest from disk each time, so a compromised webview cannot widen
//! a plugin's permissions.

pub mod manifest;
pub mod store;

use std::path::PathBuf;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// The curated catalogue. Hard-coded so the webview cannot point installs at
/// another list.
pub const REGISTRY_URL: &str =
    "https://raw.githubusercontent.com/BlueShork/maestro-deck-plugins/main/registry.json";

/// `<app data>/plugins`, alongside `tools/` and `tool_paths.json`.
pub fn plugins_root() -> Option<PathBuf> {
    let home = || std::env::var_os("HOME").map(PathBuf::from);
    let dir = if cfg!(target_os = "macos") {
        home()?.join("Library/Application Support/com.maestro-deck")
    } else if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var_os("APPDATA")?).join("maestro-deck")
    } else {
        std::env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|| home().map(|h| h.join(".local/share")))?
            .join("maestro-deck")
    };
    Some(dir.join("plugins"))
}
