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
use crate::process_ext::CommandExtNoWindow;
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

/// Physical pixels per dp on an Android device (`wm density` / 160).
/// `None` if adb can't tell; the audit then estimates from the screen width.
fn android_density(serial: &str) -> Option<f32> {
    let out = std::process::Command::new(crate::device::adb::adb_bin())
        .no_window()
        .args(["-s", serial, "shell", "wm", "density"])
        .output()
        .ok()?;
    parse_wm_density(&String::from_utf8_lossy(&out.stdout))
}

/// `wm density` prints "Physical density: 420" and, when overridden,
/// "Override density: 480" (the one in effect).
fn parse_wm_density(out: &str) -> Option<f32> {
    let value = |prefix: &str| {
        out.lines()
            .find_map(|l| l.trim().strip_prefix(prefix))
            .and_then(|v| v.trim().parse::<f32>().ok())
    };
    value("Override density:")
        .or_else(|| value("Physical density:"))
        .map(|dpi| dpi / 160.0)
}

fn android_screenshot(serial: &str) -> Option<image::RgbaImage> {
    let out = std::process::Command::new(crate::device::adb::adb_bin())
        .no_window()
        .args(["-s", serial, "exec-out", "screencap", "-p"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    image::load_from_memory_with_format(&out.stdout, image::ImageFormat::Png)
        .ok()
        .map(|i| i.to_rgba8())
}

/// Audit the screen the connected device shows right now: a fresh hierarchy
/// dump (same paths as the inspector: Android, iOS simulator / iPhone, farm)
/// plus a screenshot for the contrast rule. Called by the front when a run
/// ends with the accessibility option on, so it audits the run's final
/// screen (EFREI lot 1, MD-43 step 1).
#[tauri::command]
pub async fn a11y_audit_device(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AccessibilityReport, String> {
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or("no device connected")?;
    let platform = match device.platform {
        crate::device::Platform::Android => Platform::Android,
        crate::device::Platform::Ios => Platform::Ios,
        crate::device::Platform::Web => {
            return Err("the accessibility audit supports Android and iOS only".into())
        }
    };
    let on_farm = crate::farm::active(state.inner()).await.is_some();

    let tree = crate::ipc::commands::enter_inspect_mode(true, app, state.clone())
        .await
        .map_err(|e| e.to_string())?;
    let root = tree.root.ok_or("the current hierarchy is empty")?;

    // Screenshot + density. On the farm the device isn't local: no
    // screenshot (contrast is then not applicable) and estimated density.
    let (screenshot, px_per_unit) = if on_farm {
        (None, None)
    } else {
        match platform {
            Platform::Android => {
                let serial = device.serial.clone();
                tokio::task::spawn_blocking(move || {
                    (android_screenshot(&serial), android_density(&serial))
                })
                .await
                .map_err(|e| format!("a11y task panicked: {e}"))?
            }
            // iOS bounds are already in points.
            Platform::Ios => {
                let png =
                    match crate::ipc::commands::ensure_ios_keeper(&device.serial, state.inner())
                        .await
                    {
                        Ok(keeper) => keeper.http().screenshot().await.ok(),
                        Err(_) => None,
                    };
                let img = png.and_then(|b| {
                    image::load_from_memory_with_format(&b, image::ImageFormat::Png)
                        .ok()
                        .map(|i| i.to_rgba8())
                });
                (img, Some(1.0))
            }
        }
    };

    tokio::task::spawn_blocking(move || {
        let screen = Screen {
            name: "écran final".into(),
            root,
            screenshot,
        };
        audit(
            &[screen],
            &AuditConfig {
                platform,
                px_per_unit,
            },
        )
    })
    .await
    .map_err(|e| format!("a11y task panicked: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wm_density() {
        assert_eq!(
            parse_wm_density("Physical density: 420\n"),
            Some(420.0 / 160.0)
        );
        assert_eq!(
            parse_wm_density("Physical density: 420\nOverride density: 480\n"),
            Some(3.0)
        );
        assert_eq!(parse_wm_density("error: no devices"), None);
    }
}
