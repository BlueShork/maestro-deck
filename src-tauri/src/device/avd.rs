// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Android Virtual Device (AVD) discovery and launch.
//!
//! Shutdown AVDs are surfaced as synthetic [`Device`] entries whose serial is
//! `avd:<name>`. Connecting one boots the emulator (`emulator -avd <name>`)
//! and resolves the real `emulator-<port>` serial adb assigns once the OS
//! has finished booting.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use tracing::{debug, warn};

use super::{Device, DeviceListEntry, DeviceState, Platform};
use crate::device::adb;
use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

/// Serial prefix marking a shutdown AVD that hasn't been booted yet.
pub const AVD_SERIAL_PREFIX: &str = "avd:";

const BOOT_TIMEOUT: Duration = Duration::from_secs(120);
const BOOT_POLL_INTERVAL: Duration = Duration::from_secs(1);

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Resolve the SDK `emulator` binary: $ANDROID_HOME, $ANDROID_SDK_ROOT, the
/// default macOS SDK location, then the bare name (PATH). Never fails here —
/// a missing binary surfaces as NotFound at run time, which callers treat as
/// "no Android SDK installed".
fn emulator_bin() -> String {
    let mut candidates: Vec<PathBuf> = Vec::new();
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(root) = std::env::var_os(var) {
            candidates.push(PathBuf::from(root).join("emulator").join("emulator"));
        }
    }
    if let Some(home) = home_dir() {
        candidates.push(home.join("Library/Android/sdk/emulator/emulator"));
    }
    candidates
        .into_iter()
        .find(|p| p.exists())
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "emulator".to_string())
}

/// Directory holding `<name>.avd/config.ini`: $ANDROID_AVD_HOME or ~/.android/avd.
fn avd_home() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("ANDROID_AVD_HOME") {
        return Some(PathBuf::from(p));
    }
    home_dir().map(|h| h.join(".android").join("avd"))
}

/// Parse `emulator -list-avds` output: one AVD name per line. Recent
/// emulators sometimes prefix log noise like `INFO | Storing crashdata …`;
/// AVD names cannot contain spaces, so any line with a ` | ` separator (or
/// blank) is noise.
pub fn parse_avd_list(stdout: &str) -> Vec<String> {
    stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.contains(" | "))
        .map(str::to_string)
        .collect()
}

/// Extract a human Android version from an AVD `config.ini`, via the
/// system-image path in `image.sysdir.1`
/// (e.g. `system-images/android-34/google_apis/arm64-v8a/` → "14").
pub fn parse_config_ini_os_version(ini: &str) -> Option<String> {
    for line in ini.lines() {
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        if k.trim() != "image.sysdir.1" {
            continue;
        }
        let api = v
            .trim()
            .split('/')
            .find_map(|seg| seg.strip_prefix("android-"))?;
        // API levels are numeric ("34") except previews ("Baklava").
        return Some(match api.parse::<u32>() {
            Ok(n) => api_to_version(n),
            Err(_) => api.to_string(),
        });
    }
    None
}

/// Map an Android API level to the marketing version string, matching what
/// `getprop ro.build.version.release` reports on a booted device.
pub fn api_to_version(api: u32) -> String {
    let v = match api {
        21 => "5.0",
        22 => "5.1",
        23 => "6.0",
        24 => "7.0",
        25 => "7.1",
        26 => "8.0",
        27 => "8.1",
        28 => "9",
        29 => "10",
        30 => "11",
        31 => "12",
        32 => "12L",
        33 => "13",
        34 => "14",
        35 => "15",
        36 => "16",
        _ => return format!("API {api}"),
    };
    v.to_string()
}

fn read_avd_os_version(name: &str) -> String {
    let Some(dir) = avd_home() else {
        return String::new();
    };
    let ini = dir.join(format!("{name}.avd")).join("config.ini");
    match std::fs::read_to_string(&ini) {
        Ok(s) => parse_config_ini_os_version(&s).unwrap_or_default(),
        Err(_) => String::new(),
    }
}

fn list_avd_names() -> AppResult<Vec<String>> {
    let bin = emulator_bin();
    debug!(bin = %bin, "listing avds");
    let output = std::process::Command::new(&bin)
        .no_window()
        .arg("-list-avds")
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::EmulatorNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::EmulatorFailed(stderr));
    }
    Ok(parse_avd_list(&String::from_utf8_lossy(&output.stdout)))
}

/// Names of the AVDs behind currently-running `emulator-*` transports.
/// Best effort: a zombie transport that won't answer is simply not excluded
/// (a temporary duplicate beats an invisible AVD).
fn running_avd_names(emulator_serials: &[String]) -> HashSet<String> {
    let mut names = HashSet::new();
    for serial in emulator_serials {
        match adb::emu_avd_name(serial) {
            Ok(Some(name)) => {
                names.insert(name);
            }
            Ok(None) => {}
            Err(e) => warn!(serial = %serial, error = ?e, "emu avd name failed"),
        }
    }
    names
}

/// Shutdown AVDs as synthetic [`Device`] entries (`serial = "avd:<name>"`).
/// `emulator_serials` are the `emulator-*` transports already visible in adb;
/// their AVDs are excluded (they already show up as connected devices).
/// No Android SDK installed → empty list, not an error.
pub fn list_shutdown_avds(emulator_serials: &[String]) -> AppResult<Vec<Device>> {
    let names = match list_avd_names() {
        Ok(n) => n,
        Err(AppError::EmulatorNotFound) => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let running = running_avd_names(emulator_serials);
    let mut out: Vec<Device> = names
        .into_iter()
        .filter(|n| !running.contains(n))
        .map(|name| {
            let os = read_avd_os_version(&name);
            Device {
                serial: format!("{AVD_SERIAL_PREFIX}{name}"),
                // Display-only prettification; the connect path re-derives
                // the raw name from the serial, never from the model.
                model: name.replace('_', " "),
                android_version: os.clone(),
                screen_width: 0,
                screen_height: 0,
                platform: Platform::Android,
                os_version: os,
                booted: false,
                physical: false,
            }
        })
        .collect();
    out.sort_by(|a, b| a.model.cmp(&b.model));
    Ok(out)
}

/// A ready (`state == Device`) emulator serial that wasn't in `before`.
fn pick_new_serial(before: &HashSet<String>, entries: &[DeviceListEntry]) -> Option<String> {
    entries
        .iter()
        .filter(|e| e.state == DeviceState::Device && e.serial.starts_with("emulator-"))
        .find(|e| !before.contains(&e.serial))
        .map(|e| e.serial.clone())
}

/// Boot the named AVD and return its real `emulator-<port>` serial once
/// Android reports `sys.boot_completed=1`. The emulator process is spawned
/// detached (it must outlive the app); polling yields via tokio so the
/// async command stays responsive.
pub async fn launch_avd(name: &str) -> AppResult<String> {
    // Serials present BEFORE launch — the first new ready one is ours.
    let before: HashSet<String> = adb::list_device_entries()?
        .into_iter()
        .map(|e| e.serial)
        .filter(|s| s.starts_with("emulator-"))
        .collect();

    let bin = emulator_bin();
    debug!(bin = %bin, avd = %name, "launching emulator");
    std::process::Command::new(&bin)
        .no_window()
        .args(["-avd", name])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::EmulatorNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    let deadline = Instant::now() + BOOT_TIMEOUT;

    // Phase 1: wait for the new transport to appear in adb.
    let serial = loop {
        let found = adb::list_device_entries()
            .ok()
            .and_then(|entries| pick_new_serial(&before, &entries));
        if let Some(s) = found {
            break s;
        }
        if Instant::now() >= deadline {
            return Err(AppError::EmulatorFailed(format!(
                "Emulator '{name}' did not appear in adb within 120s"
            )));
        }
        tokio::time::sleep(BOOT_POLL_INTERVAL).await;
    };

    // Phase 2: wait for Android itself to finish booting.
    loop {
        if let Ok(out) = adb::exec_shell(&serial, "getprop sys.boot_completed") {
            if out.trim() == "1" {
                return Ok(serial);
            }
        }
        if Instant::now() >= deadline {
            return Err(AppError::EmulatorFailed(format!(
                "Emulator '{name}' did not boot within 120s"
            )));
        }
        tokio::time::sleep(BOOT_POLL_INTERVAL).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::device::{DeviceListEntry, DeviceState};
    use std::collections::HashSet;

    fn entry(serial: &str, state: DeviceState) -> DeviceListEntry {
        DeviceListEntry {
            serial: serial.to_string(),
            state,
            model: None,
            product: None,
            device: None,
            transport_id: None,
        }
    }

    #[test]
    fn parses_avd_list_plain() {
        let out = "Pixel_8_API_34\nPixel_Tablet_API_35\n";
        assert_eq!(
            parse_avd_list(out),
            vec!["Pixel_8_API_34", "Pixel_Tablet_API_35"]
        );
    }

    #[test]
    fn parses_avd_list_skips_log_noise_and_blanks() {
        let out = "INFO    | Storing crashdata in: /tmp/emu-crash.db\n\nPixel_8_API_34\n";
        assert_eq!(parse_avd_list(out), vec!["Pixel_8_API_34"]);
    }

    #[test]
    fn config_ini_extracts_numeric_api() {
        let ini = "AvdId=Pixel_8_API_34\nimage.sysdir.1=system-images/android-34/google_apis/arm64-v8a/\n";
        assert_eq!(parse_config_ini_os_version(ini), Some("14".to_string()));
    }

    #[test]
    fn config_ini_preview_api_passes_through() {
        let ini = "image.sysdir.1 = system-images/android-Baklava/google_apis/arm64-v8a/\n";
        assert_eq!(
            parse_config_ini_os_version(ini),
            Some("Baklava".to_string())
        );
    }

    #[test]
    fn config_ini_without_sysdir_is_none() {
        assert_eq!(parse_config_ini_os_version("AvdId=Foo\n"), None);
    }

    #[test]
    fn api_to_version_known_and_unknown() {
        assert_eq!(api_to_version(34), "14");
        assert_eq!(api_to_version(28), "9");
        assert_eq!(api_to_version(99), "API 99");
    }

    #[test]
    fn picks_new_ready_emulator_serial() {
        let before: HashSet<String> = ["emulator-5554".to_string()].into_iter().collect();
        let entries = vec![
            entry("emulator-5554", DeviceState::Device),
            entry("emulator-5556", DeviceState::Offline), // still booting adb-side
            entry("R58M12345A", DeviceState::Device),     // physical, ignored
        ];
        assert_eq!(pick_new_serial(&before, &entries), None);

        let entries = vec![
            entry("emulator-5554", DeviceState::Device),
            entry("emulator-5556", DeviceState::Device),
        ];
        assert_eq!(
            pick_new_serial(&before, &entries),
            Some("emulator-5556".to_string())
        );
    }
}
