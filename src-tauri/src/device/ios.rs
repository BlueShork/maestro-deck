// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS Simulator discovery via `xcrun simctl list devices`.

use std::collections::BTreeMap;
use std::process::Command;

use serde::Deserialize;
use tracing::debug;

use super::{Device, Platform};
use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

#[derive(Debug, Deserialize)]
struct SimctlOutput {
    /// runtime identifier -> list of simulators
    #[serde(default)]
    devices: BTreeMap<String, Vec<SimDevice>>,
}

#[derive(Debug, Deserialize)]
struct SimDevice {
    #[serde(default)]
    udid: String,
    #[serde(default)]
    name: String,
    #[serde(rename = "isAvailable", default)]
    is_available: bool,
    #[serde(default)]
    state: String,
}

/// Parse the iOS version out of a simctl runtime key, e.g.
/// "com.apple.CoreSimulator.SimRuntime.iOS-17-2" -> "17.2".
/// Returns None for non-iOS runtimes (tvOS/watchOS/xrOS).
fn ios_version_from_runtime(runtime: &str) -> Option<String> {
    let tail = runtime.rsplit('.').next().unwrap_or(runtime); // "iOS-17-2"
    let rest = tail.strip_prefix("iOS-")?;
    Some(rest.replace('-', "."))
}

/// Parse `xcrun simctl list devices --json` into available iOS simulators.
pub fn parse_simctl_json(json: &str) -> AppResult<Vec<Device>> {
    let parsed: SimctlOutput = serde_json::from_str(json)
        .map_err(|e| AppError::IosCommandFailed(format!("simctl JSON parse: {e}")))?;
    let mut out = Vec::new();
    for (runtime, sims) in parsed.devices {
        let Some(version) = ios_version_from_runtime(&runtime) else {
            continue; // non-iOS runtime
        };
        for s in sims {
            if !s.is_available {
                continue;
            }
            out.push(Device {
                serial: s.udid,
                model: s.name,
                android_version: String::new(),
                screen_width: 0,
                screen_height: 0,
                platform: Platform::Ios,
                os_version: version.clone(),
                booted: s.state.eq_ignore_ascii_case("Booted"),
            });
        }
    }
    Ok(out)
}

/// Enumerate available iOS simulators via `xcrun simctl`. Returns an empty list
/// (not an error) when none are present so Android discovery is never blocked.
pub fn list_devices() -> AppResult<Vec<Device>> {
    let output = Command::new("xcrun")
        .no_window()
        .args(["simctl", "list", "devices", "available", "--json"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::IosToolMissing(
                    "xcrun not found — install Xcode command-line tools".into(),
                )
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        debug!(%stderr, "simctl list failed");
        return Err(AppError::IosCommandFailed(stderr));
    }
    let json = String::from_utf8_lossy(&output.stdout);
    parse_simctl_json(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/simctl_list.json");

    #[test]
    fn parses_available_ios_sims_with_boot_state() {
        let mut devices = parse_simctl_json(FIXTURE).expect("parse");
        devices.sort_by(|a, b| a.serial.cmp(&b.serial));
        // 3 available iOS sims (booted iPhone 15 Pro, shutdown iPhone 15, shutdown iPhone 16 Pro).
        // Excluded: the unavailable one, and the tvOS device.
        assert_eq!(devices.len(), 3);

        let booted = devices
            .iter()
            .find(|d| d.serial == "AAAA-17-2-BOOTED")
            .unwrap();
        assert_eq!(booted.model, "iPhone 15 Pro");
        assert_eq!(booted.os_version, "17.2");
        assert_eq!(booted.platform, crate::device::Platform::Ios);
        assert!(booted.booted);
        assert_eq!(booted.android_version, "");

        let shut = devices
            .iter()
            .find(|d| d.serial == "CCCC-18-6-SHUT")
            .unwrap();
        assert_eq!(shut.os_version, "18.6");
        assert!(!shut.booted);
    }

    #[test]
    fn excludes_unavailable_and_non_ios() {
        let devices = parse_simctl_json(FIXTURE).expect("parse");
        let serials: Vec<&str> = devices.iter().map(|d| d.serial.as_str()).collect();
        assert!(
            !serials.contains(&"DDDD-18-6-UNAVAIL"),
            "unavailable sim excluded"
        );
        assert!(!serials.contains(&"EEEE-TV"), "tvOS excluded");
    }
}
