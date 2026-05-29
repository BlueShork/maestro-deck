// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Physical iOS device discovery via `xcrun devicectl`.

use std::process::Command;

use serde::Deserialize;
use tracing::debug;

use super::{Device, Platform};
use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

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
}

/// Parse `xcrun devicectl list devices --json-output` into `Device`s,
/// keeping only iOS hardware. Screen size is unknown here (devicectl doesn't
/// report it) -> 0 until the driver's `/deviceInfo` backfills it on connect.
pub fn parse_devicectl_json(json: &str) -> AppResult<Vec<Device>> {
    let parsed: DeviceCtlOutput = serde_json::from_str(json)
        .map_err(|e| AppError::IosCommandFailed(format!("devicectl JSON parse: {e}")))?;
    let mut out = Vec::new();
    for d in parsed.result.devices {
        if !d.hardware_properties.platform.eq_ignore_ascii_case("iOS") {
            continue;
        }
        let hw = d.hardware_properties;
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
        });
    }
    Ok(out)
}

/// Enumerate connected physical iPhones via `xcrun devicectl`. Returns an
/// empty list (not an error) when no iOS device is present so Android
/// discovery is never blocked.
pub fn list_devices() -> AppResult<Vec<Device>> {
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
    // Reached only when devicectl exited 0, so the file it wrote is fresh —
    // a stale file from a previous run can't be read here (the success guard
    // above returns early on any non-zero exit).
    let json = std::fs::read_to_string(&tmp).map_err(AppError::Io)?;
    parse_devicectl_json(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("../../tests/fixtures/devicectl_list.json");

    #[test]
    fn parses_iphone_and_skips_non_ios() {
        let devices = parse_devicectl_json(FIXTURE).expect("parse");
        assert_eq!(devices.len(), 1, "only the iOS iPhone should be returned");
        let d = &devices[0];
        assert_eq!(d.serial, "00008030-0011223344556677");
        assert_eq!(d.model, "iPhone 15 Pro Max");
        assert_eq!(d.os_version, "18.0");
        assert_eq!(d.platform, crate::device::Platform::Ios);
        assert_eq!(d.android_version, "");
        assert_eq!(d.screen_width, 0);
    }
}
