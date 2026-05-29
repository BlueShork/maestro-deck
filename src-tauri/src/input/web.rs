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

/// Build the run-command body. Maestro Studio expects `{ "yaml": "<command>",
/// "dryRun": bool }` where `<command>` is a SINGLE command line
/// (`"<name>: <options>"`) — NOT a flow list. A leading `- ` is rejected with
/// 400 "Invalid command format".
fn command_body(yaml: String) -> serde_json::Value {
    serde_json::json!({ "yaml": yaml, "dryRun": false })
}

fn tap_yaml(x_pct: f32, y_pct: f32) -> String {
    format!("tapOn: {{point: \"{x_pct}%,{y_pct}%\"}}")
}

fn swipe_yaml(x1: f32, y1: f32, x2: f32, y2: f32, duration_ms: u32) -> String {
    format!("swipe: {{start: \"{x1}%,{y1}%\", end: \"{x2}%,{y2}%\", duration: {duration_ms}}}")
}

pub async fn send(
    event: &InputEvent,
    http: &WebStudioClient,
    screen_w: u16,
    screen_h: u16,
) -> AppResult<()> {
    match event {
        InputEvent::Tap { x, y } => {
            let yaml = tap_yaml(pct(*x, screen_w), pct(*y, screen_h));
            http.run_command(command_body(yaml)).await
        }
        InputEvent::Swipe {
            x1,
            y1,
            x2,
            y2,
            duration_ms,
        } => {
            let yaml = swipe_yaml(
                pct(*x1, screen_w),
                pct(*y1, screen_h),
                pct(*x2, screen_w),
                pct(*y2, screen_h),
                *duration_ms,
            );
            http.run_command(command_body(yaml)).await
        }
        InputEvent::Text { text } => {
            http.run_command(command_body(format!("inputText: {text}")))
                .await
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
    fn command_body_wraps_yaml_with_dryrun() {
        let b = command_body("inputText: hi".to_string());
        assert_eq!(b["yaml"], "inputText: hi");
        assert_eq!(b["dryRun"], false);
    }

    #[test]
    fn commands_are_single_line_not_flows() {
        // Studio rejects a leading "- " (flow list) with 400.
        let tap = tap_yaml(50.0, 50.0);
        assert_eq!(tap, "tapOn: {point: \"50%,50%\"}");
        assert!(!tap.starts_with("- "));

        let sw = swipe_yaml(50.0, 50.0, 50.0, 20.0, 400);
        assert_eq!(
            sw,
            "swipe: {start: \"50%,50%\", end: \"50%,20%\", duration: 400}"
        );
        assert!(!sw.starts_with("- "));
    }
}
