// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web input forwarding via Maestro Studio's `POST /api/run-command`.
//! Frontend coords arrive in screenshot-pixel space; we convert taps to
//! percentage points (`x%,y%`) which Maestro resolves independent of the
//! browser viewport size.

use serde::Deserialize;

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

#[derive(Debug, Deserialize)]
struct ElBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// One element from a device-screen event (extra fields ignored).
#[derive(Debug, Deserialize)]
struct ScreenEl {
    bounds: ElBounds,
    #[serde(rename = "resourceId")]
    resource_id: Option<String>,
    text: Option<String>,
}

/// Find the smallest element containing `(cx, cy)` (CSS-pixel coords) and build
/// a `tapOn` command targeting it by selector — `id` preferred, else `text`.
/// Returns `None` if no element with a usable selector covers the point, so the
/// caller can fall back to a raw point tap.
///
/// Maestro's web driver clicks DOM elements, not raw pixels, so an element
/// selector is far more reliable than a coordinate and "snaps" to the intended
/// control even if the click lands slightly off.
fn element_selector_at(elements: &serde_json::Value, cx: i32, cy: i32) -> Option<String> {
    let els: Vec<ScreenEl> = serde_json::from_value(elements.clone()).ok()?;
    let hit = els
        .into_iter()
        .filter(|e| {
            let b = &e.bounds;
            b.width > 0
                && b.height > 0
                && cx >= b.x
                && cx < b.x + b.width
                && cy >= b.y
                && cy < b.y + b.height
        })
        .min_by_key(|e| e.bounds.width as i64 * e.bounds.height as i64)?;
    // `{:?}` yields a double-quoted, escaped scalar valid in Maestro's YAML.
    if let Some(id) = hit.resource_id.filter(|s| !s.is_empty()) {
        return Some(format!("tapOn: {{id: {id:?}}}"));
    }
    if let Some(text) = hit.text.filter(|s| !s.is_empty()) {
        return Some(format!("tapOn: {text:?}"));
    }
    None
}

/// Resolve the best `tapOn` command for a click at screenshot-pixel `(x, y)`.
/// Prefers an element selector (from a fresh screen snapshot); falls back to a
/// percentage point tap when no element resolves or the snapshot is unavailable.
async fn tap_command(
    http: &WebStudioClient,
    x: f32,
    y: f32,
    screen_w: u16,
    screen_h: u16,
) -> String {
    if screen_w > 0 && screen_h > 0 {
        if let Ok(screen) = http.device_screen().await {
            if screen.width > 0 && screen.height > 0 {
                // Map screenshot-pixel coords into the element CSS-pixel space.
                let cx = (x / screen_w as f32 * screen.width as f32) as i32;
                let cy = (y / screen_h as f32 * screen.height as f32) as i32;
                if let Some(sel) = element_selector_at(&screen.elements, cx, cy) {
                    return sel;
                }
            }
        }
    }
    tap_yaml(pct(x, screen_w), pct(y, screen_h))
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
            let yaml = tap_command(http, *x, *y, screen_w, screen_h).await;
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
    fn resolves_smallest_element_id_preferred() {
        let v = serde_json::json!([
            {"bounds":{"x":0,"y":0,"width":1200,"height":64}},
            {"bounds":{"x":400,"y":10,"width":100,"height":40},"resourceId":"Search","text":"Search…"}
        ]);
        // Point inside both → smallest (Search box) wins, id preferred.
        assert_eq!(
            element_selector_at(&v, 450, 20).as_deref(),
            Some("tapOn: {id: \"Search\"}")
        );
        // Point only in the big container (no selector) → None → point fallback.
        assert_eq!(element_selector_at(&v, 50, 5), None);
    }

    #[test]
    fn text_only_element_uses_text_selector() {
        let v = serde_json::json!([{"bounds":{"x":0,"y":0,"width":50,"height":20},"text":"Login"}]);
        assert_eq!(
            element_selector_at(&v, 10, 10).as_deref(),
            Some("tapOn: \"Login\"")
        );
    }

    #[test]
    fn no_element_under_point_returns_none() {
        let v =
            serde_json::json!([{"bounds":{"x":0,"y":0,"width":10,"height":10},"resourceId":"x"}]);
        assert_eq!(element_selector_at(&v, 500, 500), None);
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
