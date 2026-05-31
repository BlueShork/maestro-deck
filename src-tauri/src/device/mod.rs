// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! ADB device discovery and shell command execution.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Platform {
    #[default]
    Android,
    Ios,
    Web,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Device {
    pub serial: String,
    pub model: String,
    pub android_version: String,
    pub screen_width: u32,
    pub screen_height: u32,
    #[serde(default)]
    pub platform: Platform,
    #[serde(default)]
    pub os_version: String,
    /// iOS simulators only: true when the simulator is currently Booted.
    /// Always false for Android and physical devices.
    #[serde(default)]
    pub booted: bool,
    /// True only for physical iPhones (discovered via `devicectl`). Selects the
    /// `maestro-ios-device` bridge keeper + HTTP screenshot path instead of the
    /// simulator's `simctl`/`maestro studio` path. False for Android, Web, and
    /// iOS simulators.
    #[serde(default)]
    pub physical: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeviceState {
    Device,
    Unauthorized,
    Offline,
    NoPermissions,
    Recovery,
    Sideload,
    Bootloader,
    Unknown,
}

impl DeviceState {
    pub fn parse(s: &str) -> Self {
        match s {
            "device" => Self::Device,
            "unauthorized" => Self::Unauthorized,
            "offline" => Self::Offline,
            "no permissions" => Self::NoPermissions,
            "recovery" => Self::Recovery,
            "sideload" => Self::Sideload,
            "bootloader" => Self::Bootloader,
            _ => Self::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DeviceListEntry {
    pub serial: String,
    pub state: DeviceState,
    pub model: Option<String>,
    pub product: Option<String>,
    pub device: Option<String>,
    pub transport_id: Option<String>,
}

pub mod adb;
pub mod ios;
pub mod web;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_device_json_defaults_to_android() {
        let json = r#"{"serial":"R5","model":"Pixel","android_version":"14","screen_width":1080,"screen_height":2400}"#;
        let d: Device = serde_json::from_str(json).expect("deserialize");
        assert_eq!(d.platform, Platform::Android);
        assert_eq!(d.os_version, "");
    }

    #[test]
    fn web_platform_round_trips() {
        let d = Device {
            serial: "web".into(),
            model: "Web Browser (Chromium)".into(),
            android_version: String::new(),
            screen_width: 0,
            screen_height: 0,
            platform: Platform::Web,
            os_version: String::new(),
            booted: false,
            physical: false,
        };
        let s = serde_json::to_string(&d).unwrap();
        assert!(s.contains("\"platform\":\"web\""), "got {s}");
        let back: Device = serde_json::from_str(&s).unwrap();
        assert_eq!(back.platform, Platform::Web);
    }

    #[test]
    fn ios_device_round_trips() {
        let d = Device {
            serial: "00008".into(),
            model: "iPhone 15".into(),
            android_version: String::new(),
            screen_width: 1179,
            screen_height: 2556,
            platform: Platform::Ios,
            os_version: "18.0".into(),
            booted: false,
            physical: false,
        };
        let s = serde_json::to_string(&d).unwrap();
        let back: Device = serde_json::from_str(&s).unwrap();
        assert_eq!(back.platform, Platform::Ios);
        assert_eq!(back.os_version, "18.0");
    }
}
