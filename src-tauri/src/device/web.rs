// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web "device": there is nothing to enumerate — a browser is not a device —
//! so we expose a single synthetic target. Maestro manages its own Chromium;
//! a missing `maestro` surfaces at connect time, consistent with the other
//! platforms.

use super::{Device, Platform};

/// Stable serial used to identify the web target across IPC calls.
pub const WEB_SERIAL: &str = "web";

/// The single synthetic entry shown in the device list for web testing.
pub fn synthetic_target() -> Device {
    Device {
        serial: WEB_SERIAL.to_string(),
        model: "Web Browser (Chromium)".to_string(),
        android_version: String::new(),
        screen_width: 0,
        screen_height: 0,
        platform: Platform::Web,
        os_version: String::new(),
        booted: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_target_is_web() {
        let d = synthetic_target();
        assert_eq!(d.serial, "web");
        assert_eq!(d.platform, Platform::Web);
        assert!(d.model.contains("Web"));
    }
}
