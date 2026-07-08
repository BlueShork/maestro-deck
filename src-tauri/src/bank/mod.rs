// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

pub mod compare;
pub mod diff;
pub mod flow;
pub mod ipc;

pub fn device_key(model: &str, width: u32, height: u32) -> String {
    let sanitized: String = model
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{sanitized}_{width}x{height}")
}

/// Fraction of the screenshot height (from the top) to exclude from the diff
/// so the status bar (clock / notch / carrier band) doesn't cause false
/// positives. Ratio (not pixels) because status-bar-height ÷ screen-height is
/// ~constant across pixel densities. Returns 0.0 when masking is off or the
/// platform has no status bar (web).
pub fn status_bar_ratio(platform: &str, ignore: bool) -> f64 {
    if !ignore {
        return 0.0;
    }
    match platform {
        "ios" => 0.06,
        "android" => 0.045,
        _ => 0.0,
    }
}

/// Fraction of the screenshot height (from the bottom) to exclude from the
/// diff — the iOS home indicator / Android navigation (or gesture) bar. Like
/// [`status_bar_ratio`], it's a ratio so it's resolution-independent, and
/// returns 0.0 when masking is off or the platform has no bottom bar (web).
pub fn nav_bar_ratio(platform: &str, ignore: bool) -> f64 {
    if !ignore {
        return 0.0;
    }
    match platform {
        "ios" => 0.04,
        "android" => 0.045,
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_key_sanitizes_and_appends_resolution() {
        assert_eq!(
            device_key("iPhone 15 Pro", 1179, 2556),
            "iPhone_15_Pro_1179x2556"
        );
        assert_eq!(device_key("Pixel/6", 1080, 2400), "Pixel_6_1080x2400");
    }

    #[test]
    fn status_bar_ratio_per_platform() {
        assert_eq!(status_bar_ratio("ios", true), 0.06);
        assert_eq!(status_bar_ratio("android", true), 0.045);
        assert_eq!(status_bar_ratio("web", true), 0.0);
        assert_eq!(status_bar_ratio("ios", false), 0.0);
    }

    #[test]
    fn nav_bar_ratio_per_platform() {
        assert_eq!(nav_bar_ratio("ios", true), 0.04);
        assert_eq!(nav_bar_ratio("android", true), 0.045);
        assert_eq!(nav_bar_ratio("web", true), 0.0);
        assert_eq!(nav_bar_ratio("android", false), 0.0);
    }
}
