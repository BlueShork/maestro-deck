// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS device discovery: simulators via `xcrun simctl list devices` and
//! physical iPhones via `xcrun devicectl list devices`. Both surface as
//! `Platform::Ios`; physical devices carry `physical: true` so the connect /
//! keeper / screenshot paths select the `maestro-ios-device` bridge instead of
//! the simulator's `simctl` + `maestro studio`.

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
                physical: false,
            });
        }
    }
    Ok(out)
}

/// Enumerate available iOS simulators via `xcrun simctl`. Returns an empty list
/// (not an error) when none are present so Android discovery is never blocked.
fn list_simulators() -> AppResult<Vec<Device>> {
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

// ---- Physical devices (xcrun devicectl) -----------------------------------

#[derive(Debug, Deserialize)]
struct DeviceCtlOutput {
    result: DeviceCtlResult,
}
#[derive(Debug, Deserialize)]
struct DeviceCtlResult {
    #[serde(default)]
    devices: Vec<DeviceCtlDevice>,
}
#[derive(Debug, Deserialize)]
struct DeviceCtlDevice {
    #[serde(rename = "deviceProperties", default)]
    device_properties: DeviceProps,
    #[serde(rename = "hardwareProperties", default)]
    hardware_properties: HardwareProps,
    #[serde(rename = "connectionProperties", default)]
    connection_properties: ConnectionProps,
}
#[derive(Debug, Default, Deserialize)]
struct DeviceProps {
    #[serde(rename = "osVersionNumber", default)]
    os_version_number: String,
}
#[derive(Debug, Default, Deserialize)]
struct HardwareProps {
    #[serde(default)]
    udid: String,
    #[serde(rename = "marketingName", default)]
    marketing_name: String,
    #[serde(rename = "productType", default)]
    product_type: String,
    #[serde(default)]
    platform: String,
    /// "physical" for real hardware, "simulator" for simulators.
    #[serde(default)]
    reality: String,
}
#[derive(Debug, Default, Deserialize)]
struct ConnectionProps {
    /// Present (e.g. "wired"/"localNetwork") only while the device is actually
    /// connected; absent for paired-but-disconnected devices.
    #[serde(rename = "transportType", default)]
    transport_type: Option<String>,
    #[serde(rename = "tunnelState", default)]
    tunnel_state: Option<String>,
}

impl ConnectionProps {
    /// A device is currently reachable when it advertises a transport and its
    /// tunnel isn't "unavailable" (the state devicectl reports for stale paired
    /// devices that aren't plugged in). NOTE: a plugged-in iOS 17+ device idles
    /// at `tunnelState: "disconnected"` until a CoreDevice client connects, so
    /// we must NOT require "connected" — only the presence of a transport.
    fn is_connected(&self) -> bool {
        self.transport_type.is_some() && self.tunnel_state.as_deref() != Some("unavailable")
    }
}

/// Parse `xcrun devicectl list devices --json-output` into connected physical
/// iOS devices. Screen size is unknown here (devicectl doesn't report it) -> 0
/// until the driver's `/deviceInfo` backfills it on connect.
pub fn parse_devicectl_json(json: &str) -> AppResult<Vec<Device>> {
    let parsed: DeviceCtlOutput = serde_json::from_str(json)
        .map_err(|e| AppError::IosCommandFailed(format!("devicectl JSON parse: {e}")))?;
    let mut out = Vec::new();
    for d in parsed.result.devices {
        let hw = d.hardware_properties;
        let conn = d.connection_properties;
        if !hw.platform.eq_ignore_ascii_case("iOS") {
            continue;
        }
        // Exclude simulators (devicectl lists them too — simctl owns those). We
        // check for "simulator" explicitly so older devicectl versions that omit
        // `reality` (defaults to "") still treat real devices as physical.
        if hw.reality.eq_ignore_ascii_case("simulator") {
            continue;
        }
        if !conn.is_connected() {
            continue;
        }
        let model = if hw.marketing_name.is_empty() {
            hw.product_type
        } else {
            hw.marketing_name
        };
        out.push(Device {
            serial: hw.udid,
            model,
            android_version: String::new(),
            screen_width: 0,
            screen_height: 0,
            platform: Platform::Ios,
            os_version: d.device_properties.os_version_number,
            booted: false,
            physical: true,
        });
    }
    Ok(out)
}

/// Enumerate connected physical iPhones via `xcrun devicectl`. Returns an empty
/// list (not an error) when no device / Xcode is present so simulator and
/// Android discovery are never blocked.
fn list_physical() -> AppResult<Vec<Device>> {
    let bin = crate::tool_paths::devicectl_bin();
    let tmp = std::env::temp_dir().join("maestro-deck-devicectl.json");
    let output = Command::new(&bin)
        .no_window()
        .args(["list", "devices", "--timeout", "5", "--json-output"])
        .arg(&tmp)
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::IosToolMissing(
                    "xcrun devicectl not found — install Xcode command-line tools".into(),
                )
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        debug!(%stderr, "devicectl list failed");
        return Err(AppError::IosCommandFailed(stderr));
    }
    let json = std::fs::read_to_string(&tmp).map_err(AppError::Io)?;
    parse_devicectl_json(&json)
}

/// Enumerate all iOS targets: available simulators **plus** connected physical
/// iPhones. Either source failing (no Xcode, no device) yields an empty list
/// for that source rather than blocking the other — discovery is best-effort.
pub fn list_devices() -> AppResult<Vec<Device>> {
    let mut out = list_simulators().unwrap_or_default();
    out.extend(list_physical().unwrap_or_default());
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/simctl_list.json");
    const DEVICECTL_FIXTURE: &str = include_str!("../../tests/fixtures/devicectl_list.json");

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
        assert!(!booted.physical);
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

    #[test]
    fn parses_connected_physical_iphone_marked_physical() {
        let devices = parse_devicectl_json(DEVICECTL_FIXTURE).expect("parse");
        // Fixture has 3: a wired iPhone (tunnel "disconnected" but plugged in),
        // an iPad with no transport (tunnel "unavailable" → unplugged), and a
        // devicectl-listed simulator. Only the wired iPhone should survive.
        assert_eq!(devices.len(), 1, "only the connected physical iPhone");
        let d = &devices[0];
        assert_eq!(d.serial, "00008150-001909C011A1401C");
        assert_eq!(d.model, "iPhone 17 Pro");
        assert_eq!(d.os_version, "26.5");
        assert_eq!(d.platform, crate::device::Platform::Ios);
        assert!(d.physical, "physical devices carry physical: true");
        assert!(!d.booted);
    }
}
