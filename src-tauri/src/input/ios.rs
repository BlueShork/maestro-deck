// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS input forwarding over the XCTest HTTP server. Frontend coords arrive
//! in screenshot PIXEL space; iOS `/touch` expects POINTS, so we divide by the
//! device scale (pixels/points) derived from `/deviceInfo`.

use super::InputEvent;
use crate::error::AppResult;
use crate::ios_session::{IosHttpClient, SwipeBody};

/// Convert a coordinate from screenshot-pixel space to logical points.
/// `screen_px` / `screen_pt` are the device's width (or height) in each space.
pub fn px_to_pt(coord_px: f32, screen_px: u32, screen_pt: u32) -> f32 {
    if screen_px == 0 || screen_pt == 0 {
        return coord_px;
    }
    coord_px * screen_pt as f32 / screen_px as f32
}

/// Send an input event to the iOS device. `screen_w/screen_h` are the PIXEL
/// dims the frontend used (the screenshot frame size); `pt_w/pt_h` are the
/// device's point dims (from cached `/deviceInfo`).
pub async fn send(
    event: &InputEvent,
    http: &IosHttpClient,
    screen_w: u16,
    screen_h: u16,
    pt_w: u32,
    pt_h: u32,
) -> AppResult<()> {
    let to_pt = |x: f32, y: f32| {
        (
            px_to_pt(x, screen_w as u32, pt_w),
            px_to_pt(y, screen_h as u32, pt_h),
        )
    };
    match event {
        InputEvent::Tap { x, y } => {
            let (px, py) = to_pt(*x, *y);
            http.touch(px, py, 0.0).await
        }
        InputEvent::Swipe {
            x1,
            y1,
            x2,
            y2,
            duration_ms,
        } => {
            let (sx, sy) = to_pt(*x1, *y1);
            let (ex, ey) = to_pt(*x2, *y2);
            http.swipe(&SwipeBody {
                start_x: sx,
                start_y: sy,
                end_x: ex,
                end_y: ey,
                duration: *duration_ms as f32 / 1000.0,
            })
            .await
        }
        InputEvent::Text { text } => http.input_text(text).await,
        // The iOS XCTest HTTP transport has no key-injection endpoint, so
        // arbitrary keycodes are a no-op in V1 (Android-only feature).
        InputEvent::Key { .. } => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_pixels_to_points() {
        assert_eq!(px_to_pt(1179.0, 1179, 393), 393.0);
        assert_eq!(px_to_pt(0.0, 1179, 393), 0.0);
        assert!((px_to_pt(589.5, 1179, 393) - 196.5).abs() < 0.01);
    }

    #[test]
    fn px_to_pt_is_identity_when_dims_zero() {
        assert_eq!(px_to_pt(100.0, 0, 0), 100.0);
    }
}
