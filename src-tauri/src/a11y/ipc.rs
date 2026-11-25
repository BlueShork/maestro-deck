// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! IPC entry point: audit the screen currently shown in the inspector.
//!
//! First integration step of lot 1. It reuses the hierarchy the inspector
//! already dumped (`AppState::last_hierarchy`) plus an optional screenshot
//! sent by the front, so it doesn't add any device round-trip. Hooking the
//! audit into runs (`takeScreenshot` steps + final screen) comes next.

use base64::Engine;
use tauri::State;

use super::{audit, AccessibilityReport, AuditConfig, Platform, Screen};
use crate::state::AppState;

fn decode_png(b64: &str) -> Result<image::RgbaImage, String> {
    let payload = b64.split_once(',').map(|(_, d)| d).unwrap_or(b64); // tolerate data: URLs
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .map_err(|e| format!("invalid base64 screenshot: {e}"))?;
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .map(|i| i.to_rgba8())
        .map_err(|e| format!("invalid PNG screenshot: {e}"))
}

#[tauri::command]
pub async fn a11y_audit_screen(
    platform: Platform,
    screenshot_png_base64: Option<String>,
    px_per_unit: Option<f32>,
    state: State<'_, AppState>,
) -> Result<AccessibilityReport, String> {
    let tree = state
        .last_hierarchy
        .read()
        .clone()
        .ok_or("no hierarchy yet: open the inspector on a screen first")?;
    let root = tree.root.clone().ok_or("the current hierarchy is empty")?;
    tokio::task::spawn_blocking(move || {
        let screenshot = screenshot_png_base64
            .as_deref()
            .map(decode_png)
            .transpose()?;
        let screen = Screen {
            name: "écran courant".into(),
            root,
            screenshot,
        };
        let config = AuditConfig {
            platform,
            px_per_unit,
        };
        Ok(audit(&[screen], &config))
    })
    .await
    .map_err(|e| format!("a11y task panicked: {e}"))?
}
