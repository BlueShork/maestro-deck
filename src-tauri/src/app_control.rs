// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Launch / stop the app under test on the connected device.
//! v1 supports Android (adb) and iOS simulators (simctl); physical iOS and
//! web return a clear error asking the user to do it manually.

use tauri::State;

use crate::device::{Device, Platform};
use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;
use crate::state::AppState;

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

pub enum Action {
    Launch,
    Stop,
}

// ---------------------------------------------------------------------------
// Pure argv builder (no I/O — fully unit-tested)
// ---------------------------------------------------------------------------

/// A resolved command: program + argument list, ready to hand to
/// `tokio::process::Command`. No process is spawned here; the struct is
/// separated so the builder can be tested without any subprocess side-effects.
#[derive(Debug, PartialEq)]
pub struct ToolCmd {
    pub program: String,
    pub args: Vec<String>,
}

/// Build the command for the given device. For Android, `adb` is the program
/// path passed in (so tests can pass `"adb"` without reading the global cache).
/// Returns `Err` for physical iOS (ask the user to do it manually) and Web
/// (no supported mechanism).
pub fn build_cmd(
    platform: Platform,
    serial: &str,
    physical: bool,
    app_id: &str,
    action: Action,
    adb: &str,
) -> AppResult<ToolCmd> {
    match platform {
        Platform::Android => {
            let args = match action {
                Action::Launch => vec![
                    "-s".into(),
                    serial.into(),
                    "shell".into(),
                    "monkey".into(),
                    "-p".into(),
                    app_id.into(),
                    "-c".into(),
                    "android.intent.category.LAUNCHER".into(),
                    "1".into(),
                ],
                Action::Stop => vec![
                    "-s".into(),
                    serial.into(),
                    "shell".into(),
                    "am".into(),
                    "force-stop".into(),
                    app_id.into(),
                ],
            };
            Ok(ToolCmd {
                program: adb.into(),
                args,
            })
        }
        Platform::Ios => {
            if physical {
                return Err(AppError::Other(
                    "launch_app / stop_app are not supported on physical iOS devices — \
                     please launch or stop the app manually on the device."
                        .into(),
                ));
            }
            let simctl_cmd = match action {
                Action::Launch => "launch",
                Action::Stop => "terminate",
            };
            Ok(ToolCmd {
                program: "xcrun".into(),
                args: vec![
                    "simctl".into(),
                    simctl_cmd.into(),
                    serial.into(),
                    app_id.into(),
                ],
            })
        }
        Platform::Web => Err(AppError::Other(
            "launch_app / stop_app are not supported for web — \
             navigate to the app URL in your browser instead."
                .into(),
        )),
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

fn current_device(state: &AppState) -> AppResult<Device> {
    state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)
}

async fn run(device: Device, app_id: &str, action: Action) -> AppResult<()> {
    let adb = crate::tool_paths::adb_bin();
    let cmd = build_cmd(
        device.platform,
        &device.serial,
        device.physical,
        app_id,
        action,
        &adb,
    )?;
    let out = tokio::process::Command::new(&cmd.program)
        .args(&cmd.args)
        .no_window()
        .output()
        .await
        .map_err(AppError::Io)?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg: String = stderr.chars().take(300).collect();
        return Err(AppError::Other(msg));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn launch_app(app_id: String, state: State<'_, AppState>) -> AppResult<()> {
    run(current_device(&state)?, &app_id, Action::Launch).await
}

#[tauri::command]
pub async fn stop_app(app_id: String, state: State<'_, AppState>) -> AppResult<()> {
    run(current_device(&state)?, &app_id, Action::Stop).await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── Android ──────────────────────────────────────────────────────────────

    #[test]
    fn android_launch_argv() {
        let cmd = build_cmd(
            Platform::Android,
            "s1",
            false,
            "com.x",
            Action::Launch,
            "adb",
        )
        .unwrap();
        assert_eq!(cmd.program, "adb");
        assert_eq!(
            cmd.args,
            vec![
                "-s",
                "s1",
                "shell",
                "monkey",
                "-p",
                "com.x",
                "-c",
                "android.intent.category.LAUNCHER",
                "1",
            ]
        );
    }

    #[test]
    fn android_stop_argv() {
        let cmd = build_cmd(Platform::Android, "s1", false, "com.x", Action::Stop, "adb").unwrap();
        assert_eq!(cmd.program, "adb");
        assert_eq!(
            cmd.args,
            vec!["-s", "s1", "shell", "am", "force-stop", "com.x"]
        );
    }

    // ── iOS simulator ────────────────────────────────────────────────────────

    #[test]
    fn ios_sim_launch_argv() {
        let cmd = build_cmd(
            Platform::Ios,
            "UDID-1234",
            false,
            "com.x",
            Action::Launch,
            "adb",
        )
        .unwrap();
        assert_eq!(cmd.program, "xcrun");
        assert_eq!(cmd.args, vec!["simctl", "launch", "UDID-1234", "com.x"]);
    }

    #[test]
    fn ios_sim_stop_argv() {
        let cmd = build_cmd(
            Platform::Ios,
            "UDID-1234",
            false,
            "com.x",
            Action::Stop,
            "adb",
        )
        .unwrap();
        assert_eq!(cmd.program, "xcrun");
        assert_eq!(cmd.args, vec!["simctl", "terminate", "UDID-1234", "com.x"]);
    }

    // ── Physical iOS → error ─────────────────────────────────────────────────

    #[test]
    fn ios_physical_launch_errors() {
        let result = build_cmd(
            Platform::Ios,
            "UDID-P",
            true,
            "com.x",
            Action::Launch,
            "adb",
        );
        assert!(result.is_err(), "expected Err for physical iOS launch");
    }

    #[test]
    fn ios_physical_stop_errors() {
        let result = build_cmd(Platform::Ios, "UDID-P", true, "com.x", Action::Stop, "adb");
        assert!(result.is_err(), "expected Err for physical iOS stop");
    }

    // ── Web → error ───────────────────────────────────────────────────────────

    #[test]
    fn web_launch_errors() {
        let result = build_cmd(
            Platform::Web,
            "web",
            false,
            "https://x.com",
            Action::Launch,
            "adb",
        );
        assert!(result.is_err(), "expected Err for web launch");
    }

    #[test]
    fn web_stop_errors() {
        let result = build_cmd(
            Platform::Web,
            "web",
            false,
            "https://x.com",
            Action::Stop,
            "adb",
        );
        assert!(result.is_err(), "expected Err for web stop");
    }
}
