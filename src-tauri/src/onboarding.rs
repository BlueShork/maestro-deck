// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Support for the hands-on onboarding.
//!
//! The sample app is written for this and bundled as a resource: targeting an
//! app already on the phone would mean depending on the manufacturer's UI, and
//! an onboarding that fails on some phones is worse than none. Its sources and
//! build script live in `sample-app/`.

use tauri::{AppHandle, Manager};
use tracing::info;

use crate::error::{AppError, AppResult};
use crate::tool_paths;

/// Package name declared in sample-app/AndroidManifest.xml. Shared with the
/// frontend, which writes it into the flow it generates.
pub const SAMPLE_APP_ID: &str = "com.maestrodeck.sample";

/// Absolute path to the bundled APK.
///
/// Resource resolution points inside the bundle, which only exists once the app
/// has been packaged: under `tauri dev` it resolves to `target/debug/resources`
/// and nothing has been copied there. Falling back to the source tree keeps the
/// walkthrough working in development, where it is most often exercised.
pub fn sample_apk_path(app: &AppHandle) -> AppResult<std::path::PathBuf> {
    const REL: &str = "resources/sample-app.apk";

    let bundled = app
        .path()
        .resolve(REL, tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|p| p.is_file());
    if let Some(path) = bundled {
        return Ok(path);
    }

    let in_tree = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(REL);
    if in_tree.is_file() {
        return Ok(in_tree);
    }

    Err(AppError::Other(format!(
        "sample app not found — neither in the bundle nor at {}",
        in_tree.display()
    )))
}

async fn adb_install(adb: &str, serial: &str, apk: &std::path::Path) -> AppResult<(bool, String)> {
    let out = tokio::process::Command::new(adb)
        .args(["-s", serial, "install", "-r"])
        .arg(apk)
        .output()
        .await
        .map_err(|e| AppError::AdbFailed(format!("installing the sample app: {e}")))?;

    // adb exits 0 and prints "Failure [...]" on a refused install, so the exit
    // status alone would report success for an app that is not there.
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let combined = format!("{stdout}{stderr}");
    Ok((
        out.status.success() && !combined.contains("Failure"),
        combined,
    ))
}

/// Installs the sample app on `serial`.
///
/// `-r` so a second walkthrough replaces the first install rather than failing.
///
/// A copy signed by a different build cannot be upgraded in place — Android
/// answers INSTALL_FAILED_UPDATE_INCOMPATIBLE — so that one case is retried
/// after removing the old copy. The package is ours and holds nothing the user
/// put there, which is why removing it is safe to do without asking.
#[tauri::command]
pub async fn install_sample_app(app: AppHandle, serial: String) -> AppResult<String> {
    let apk = sample_apk_path(&app)?;
    let adb = tool_paths::adb_bin();

    let (ok, output) = adb_install(&adb, &serial, &apk).await?;
    if ok {
        info!(serial, "sample app installed");
        return Ok(SAMPLE_APP_ID.to_string());
    }

    if output.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
        info!(serial, "removing a sample app from an earlier build");
        let _ = tokio::process::Command::new(&adb)
            .args(["-s", &serial, "uninstall", SAMPLE_APP_ID])
            .output()
            .await;

        let (ok, retry_output) = adb_install(&adb, &serial, &apk).await?;
        if ok {
            info!(serial, "sample app reinstalled");
            return Ok(SAMPLE_APP_ID.to_string());
        }
        return Err(AppError::AdbFailed(format!(
            "could not install the sample app: {}",
            retry_output.trim()
        )));
    }

    Err(AppError::AdbFailed(format!(
        "could not install the sample app: {}",
        output.trim()
    )))
}

/// The APK the cloud path uploads as its job artefact.
#[tauri::command]
pub fn sample_app_apk(app: AppHandle) -> AppResult<String> {
    Ok(sample_apk_path(&app)?.to_string_lossy().into_owned())
}
