// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web input forwarding via Maestro Studio's `POST /api/run-command`.
//! Frontend coords arrive in screenshot-pixel space; we convert taps to
//! percentage points (`x%,y%`) which Maestro resolves independent of the
//! browser viewport size.

use super::InputEvent;
use crate::error::AppResult;
use crate::web_session::WebStudioClient;

/// Clamp a 0..=100 percentage with one decimal of precision.
fn pct(coord: f32, span: u16) -> f32 {
    if span == 0 {
        return 0.0;
    }
    let p = coord / span as f32 * 100.0;
    (p.clamp(0.0, 100.0) * 10.0).round() / 10.0
}

/// Build the run-command body for a single command. Maestro Studio expects
/// `{ "yaml": "<command yaml>", "dryRun": bool }`.
fn command_body(yaml: String) -> serde_json::Value {
    serde_json::json!({ "yaml": yaml, "dryRun": false })
}

pub async fn send(
    event: &InputEvent,
    http: &WebStudioClient,
    screen_w: u16,
    screen_h: u16,
) -> AppResult<()> {
    match event {
        InputEvent::Tap { x, y } => {
            let yaml = format!(
                "- tapOn:\n    point: {}%,{}%",
                pct(*x, screen_w),
                pct(*y, screen_h)
            );
            http.run_command(command_body(yaml)).await
        }
        InputEvent::Swipe {
            x1,
            y1,
            x2,
            y2,
            duration_ms,
        } => {
            let yaml = format!(
                "- swipe:\n    start: {}%,{}%\n    end: {}%,{}%\n    duration: {}",
                pct(*x1, screen_w),
                pct(*y1, screen_h),
                pct(*x2, screen_w),
                pct(*y2, screen_h),
                duration_ms
            );
            http.run_command(command_body(yaml)).await
        }
        InputEvent::Text { text } => {
            let yaml = format!("- inputText: {text}");
            http.run_command(command_body(yaml)).await
        }
        // No general key-injection over the web driver in V1 (Android-only).
        InputEvent::Key { .. } => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_pixel_to_percentage() {
        assert_eq!(pct(640.0, 1280), 50.0);
        assert_eq!(pct(0.0, 800), 0.0);
        assert_eq!(pct(800.0, 800), 100.0);
    }

    #[test]
    fn pct_is_zero_when_span_zero() {
        assert_eq!(pct(100.0, 0), 0.0);
    }

    #[test]
    fn command_body_wraps_yaml() {
        let b = command_body("- inputText: hi".to_string());
        assert_eq!(b["yaml"], "- inputText: hi");
    }
}
