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
    install_replacing_incompatible(&tool_paths::adb_bin(), &serial, &apk).await
}

async fn install_replacing_incompatible(
    adb: &str,
    serial: &str,
    apk: &std::path::Path,
) -> AppResult<String> {
    let (ok, output) = adb_install(adb, serial, apk).await?;
    if ok {
        info!(serial, "sample app installed");
        return Ok(SAMPLE_APP_ID.to_string());
    }

    if output.contains("INSTALL_FAILED_UPDATE_INCOMPATIBLE") {
        info!(serial, "removing a sample app from an earlier build");
        let _ = tokio::process::Command::new(adb)
            .args(["-s", serial, "uninstall", SAMPLE_APP_ID])
            .output()
            .await;

        let (ok, retry_output) = adb_install(adb, serial, apk).await?;
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

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A stand-in for adb: a shell script that logs each call to `calls` and
    /// answers `install` with whatever the scenario says.
    struct FakeAdb {
        _dir: tempfile::TempDir,
        bin: String,
        calls: std::path::PathBuf,
        apk: std::path::PathBuf,
    }

    impl FakeAdb {
        /// `install_script` runs for `adb install`; `$STATE` is a file the
        /// script can use to behave differently after an uninstall.
        fn new(install_script: &str) -> Self {
            let dir = tempfile::tempdir().unwrap();
            let calls = dir.path().join("calls");
            let state = dir.path().join("uninstalled");
            let bin = dir.path().join("adb");
            let script = format!(
                "#!/bin/sh\nSTATE='{}'\necho \"$*\" >> '{}'\ncase \"$3\" in\n  uninstall) touch \"$STATE\"; echo Success ;;\n  install) {install_script} ;;\nesac\n",
                state.display(),
                calls.display(),
            );
            std::fs::write(&bin, script).unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            let apk = dir.path().join("sample.apk");
            std::fs::write(&apk, b"apk").unwrap();
            FakeAdb {
                bin: bin.to_string_lossy().into_owned(),
                calls,
                apk,
                _dir: dir,
            }
        }

        fn calls(&self) -> Vec<String> {
            std::fs::read_to_string(&self.calls)
                .unwrap_or_default()
                .lines()
                .map(|l| l.split(' ').take(3).collect::<Vec<_>>().join(" "))
                .collect()
        }
    }

    #[tokio::test]
    async fn a_clean_install_returns_the_sample_app_id() {
        let adb = FakeAdb::new("echo Success");

        let id = install_replacing_incompatible(&adb.bin, "R58M", &adb.apk)
            .await
            .unwrap();

        assert_eq!(id, SAMPLE_APP_ID);
        assert_eq!(adb.calls(), ["-s R58M install"]);
    }

    #[tokio::test]
    async fn a_refusal_printed_with_exit_status_zero_is_still_a_failure() {
        // Older adb builds exit 0 and only print the failure.
        let adb = FakeAdb::new("echo 'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]'; exit 0");

        let err = install_replacing_incompatible(&adb.bin, "R58M", &adb.apk)
            .await
            .unwrap_err()
            .to_string();

        assert!(err.contains("INSTALL_FAILED_INSUFFICIENT_STORAGE"), "{err}");
        assert_eq!(
            adb.calls(),
            ["-s R58M install"],
            "must not uninstall for this failure"
        );
    }

    #[tokio::test]
    async fn a_non_zero_exit_is_a_failure() {
        let adb = FakeAdb::new("echo 'device offline' >&2; exit 1");

        let err = install_replacing_incompatible(&adb.bin, "R58M", &adb.apk)
            .await
            .unwrap_err()
            .to_string();

        assert!(err.contains("device offline"), "{err}");
    }

    #[tokio::test]
    async fn a_copy_signed_by_another_build_is_removed_then_reinstalled() {
        let adb = FakeAdb::new(
            "if [ -f \"$STATE\" ]; then echo Success; \
             else echo 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: signatures do not match]'; exit 1; fi",
        );

        let id = install_replacing_incompatible(&adb.bin, "R58M", &adb.apk)
            .await
            .unwrap();

        assert_eq!(id, SAMPLE_APP_ID);
        assert_eq!(
            adb.calls(),
            ["-s R58M install", "-s R58M uninstall", "-s R58M install"]
        );
    }

    #[tokio::test]
    async fn only_the_sample_app_is_ever_uninstalled() {
        let adb = FakeAdb::new(
            "if [ -f \"$STATE\" ]; then echo Success; \
             else echo 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]'; exit 1; fi",
        );

        install_replacing_incompatible(&adb.bin, "R58M", &adb.apk)
            .await
            .unwrap();

        let log = std::fs::read_to_string(&adb.calls).unwrap();
        assert!(log.contains(&format!("uninstall {SAMPLE_APP_ID}")), "{log}");
    }

    #[tokio::test]
    async fn a_reinstall_that_still_fails_reports_the_second_error() {
        let adb = FakeAdb::new(
            "if [ -f \"$STATE\" ]; then echo 'Failure [INSTALL_FAILED_VERIFICATION_FAILURE]'; exit 1; \
             else echo 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]'; exit 1; fi",
        );

        let err = install_replacing_incompatible(&adb.bin, "R58M", &adb.apk)
            .await
            .unwrap_err()
            .to_string();

        assert!(err.contains("INSTALL_FAILED_VERIFICATION_FAILURE"), "{err}");
    }
}
