// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

pub fn device_key(model: &str, width: u32, height: u32) -> String {
    let sanitized: String = model
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    format!("{sanitized}_{width}x{height}")
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
}
