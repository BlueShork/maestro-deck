// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! UI hierarchy dump + parse.
//!
//! Primary path: shell out to `maestro --device <serial> hierarchy` which uses
//! Maestro's on-device driver. This driver exposes Compose semantics nodes,
//! React Native widgets, and accessibility metadata that raw `uiautomator dump`
//! does not surface, and stays in sync with whatever Maestro CLI is installed.
//!
//! Fast path (opt-in): spawn `maestro studio` once to install+start the
//! on-device driver, then talk gRPC directly to it (port 7001 via adb
//! forward). Bindings for that gRPC service are generated from
//! `proto/maestro_android.proto` and re-exported via the `proto` submodule.
//!
//! `parse_xml` is kept for the unit-test fixture (UIAutomator XML format)
//! and is also what consumes the driver's direct `ViewHierarchyResponse`.

pub mod grpc_client;
pub mod ios;
pub mod proto;
pub mod studio;
pub mod web;

use std::collections::HashMap;
use std::process::Command;

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

impl Bounds {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        x >= self.left && x < self.right && y >= self.top && y < self.bottom
    }

    pub fn area(&self) -> i64 {
        let w = (self.right - self.left).max(0) as i64;
        let h = (self.bottom - self.top).max(0) as i64;
        w * h
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UINode {
    pub id: String,
    pub resource_id: Option<String>,
    pub text: Option<String>,
    pub content_desc: Option<String>,
    pub class_name: String,
    pub package: String,
    pub bounds: Bounds,
    pub clickable: bool,
    pub enabled: bool,
    pub focused: bool,
    pub children: Vec<UINode>,
}

#[derive(Debug, Default, Clone)]
pub struct HierarchyTree {
    pub root: Option<UINode>,
    pub xml_raw: String,
}

/// Number of attempts when the on-device driver isn't ready yet (e.g. after a
/// `maestro test` was killed and the driver process is restarting).
const HIERARCHY_RETRIES: usize = 3;
/// Shorter than it was historically (800 ms): in practice the on-device
/// driver recovers in ~100–200 ms, and a long sleep here compounds with the
/// subprocess spawn cost to push total hierarchy time into multi-second
/// territory on flaky/warmup paths.
const RETRY_DELAY: std::time::Duration = std::time::Duration::from_millis(250);

/// Resolves to the user's `maestro` install — see `crate::tool_paths` for
/// the full priority chain (user override → env → common paths → shell).
fn maestro_bin() -> String {
    crate::tool_paths::maestro_bin()
}

/// True for errors that indicate the on-device gRPC driver isn't yet up. These
/// typically resolve in a few hundred ms, so we just wait and retry.
fn is_driver_warmup_error(stderr: &str) -> bool {
    stderr.contains("UNAVAILABLE")
        || stderr.contains("Connection refused")
        || stderr.contains("io exception")
}

pub fn dump_hierarchy(serial: &str) -> AppResult<HierarchyTree> {
    let bin = maestro_bin();
    let overall_start = std::time::Instant::now();
    let mut last_err: Option<String> = None;
    for attempt in 0..HIERARCHY_RETRIES {
        let attempt_start = std::time::Instant::now();
        let output = Command::new(&bin)
            .no_window()
            .args(["--udid", serial, "hierarchy"])
            .output()
            .map_err(|e| {
                if e.kind() == std::io::ErrorKind::NotFound {
                    AppError::RunnerNotFound
                } else {
                    AppError::Io(e)
                }
            })?;
        let subprocess_ms = attempt_start.elapsed().as_millis();

        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
            let parse_start = std::time::Instant::now();
            let result = parse_maestro_json(&stdout);
            let parse_ms = parse_start.elapsed().as_millis();
            info!(
                attempt,
                subprocess_ms,
                parse_ms,
                total_ms = overall_start.elapsed().as_millis(),
                bytes = stdout.len(),
                "hierarchy dump complete"
            );
            return result;
        }

        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        info!(
            attempt,
            subprocess_ms,
            warmup = is_driver_warmup_error(&stderr),
            "hierarchy dump attempt failed"
        );
        last_err = Some(stderr.clone());
        if attempt + 1 < HIERARCHY_RETRIES && is_driver_warmup_error(&stderr) {
            debug!(attempt, "driver not ready, retrying in {:?}", RETRY_DELAY);
            std::thread::sleep(RETRY_DELAY);
            continue;
        }
        break;
    }

    let raw = last_err.unwrap_or_default();
    // Surface a short, actionable message; the full stack trace lives in the
    // logs for debugging.
    let summary = raw
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("unknown error")
        .trim()
        .to_string();
    debug!(stderr = %raw, "maestro hierarchy failed");
    Err(AppError::HierarchyParse(format!(
        "maestro hierarchy failed: {summary}. The on-device driver may not be up — try again in a moment, or run `maestro test` once to (re)install the driver."
    )))
}

/// Parse the JSON output of `maestro hierarchy`. The CLI may print log lines
/// before the JSON payload, so we locate the first `{` and parse from there.
pub fn parse_maestro_json(raw: &str) -> AppResult<HierarchyTree> {
    let start = raw.find('{').ok_or_else(|| {
        AppError::HierarchyParse("no JSON object found in maestro hierarchy output".into())
    })?;
    let json = &raw[start..];
    let root: MaestroNode = serde_json::from_str(json)
        .map_err(|e| AppError::HierarchyParse(format!("JSON parse error: {e}")))?;
    let mut next_index = 0usize;
    let ui_root = convert_maestro_node(root, &mut next_index);
    Ok(HierarchyTree {
        root: Some(ui_root),
        xml_raw: raw.to_string(),
    })
}

#[derive(Debug, Deserialize)]
struct MaestroNode {
    #[serde(default)]
    attributes: HashMap<String, String>,
    #[serde(default)]
    children: Vec<MaestroNode>,
}

fn convert_maestro_node(node: MaestroNode, next_index: &mut usize) -> UINode {
    let attrs = &node.attributes;
    let bounds = attrs
        .get("bounds")
        .and_then(|s| parse_bounds(s))
        .unwrap_or(Bounds {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        });
    let id = next_index.to_string();
    *next_index += 1;
    let children = node
        .children
        .into_iter()
        .map(|c| convert_maestro_node(c, next_index))
        .collect();

    UINode {
        id,
        resource_id: attrs.get("resource-id").cloned().filter(|s| !s.is_empty()),
        text: attrs.get("text").cloned().filter(|s| !s.is_empty()),
        // Maestro/Compose may surface accessibility under `accessibilityText`
        // (Compose's contentDescription) or the legacy `content-desc`.
        content_desc: attrs
            .get("content-desc")
            .or_else(|| attrs.get("accessibilityText"))
            .cloned()
            .filter(|s| !s.is_empty()),
        class_name: attrs.get("class").cloned().unwrap_or_default(),
        package: attrs.get("package").cloned().unwrap_or_default(),
        bounds,
        clickable: attrs.get("clickable").map(|s| s == "true").unwrap_or(false),
        enabled: attrs.get("enabled").map(|s| s == "true").unwrap_or(true),
        focused: attrs.get("focused").map(|s| s == "true").unwrap_or(false),
        children,
    }
}

/// Parse a UIAutomator XML dump into a tree.
///
/// Real-world Maestro / UiAutomator dumps commonly emit *several*
/// top-level `<node>` children directly under `<hierarchy>` — one per
/// visible window (system UI status bar + navigation bar + the app
/// itself + any overlay like Samsung's edge panel trigger). We collect
/// all of them into `top_level` and wrap them in a synthetic root
/// when there's more than one so the inspector sees the full screen
/// instead of only the last window dumped.
pub fn parse_xml(xml: &str) -> AppResult<HierarchyTree> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<UINode> = Vec::new();
    let mut top_level: Vec<UINode> = Vec::new();
    let mut next_index: usize = 0;

    loop {
        match reader
            .read_event()
            .map_err(|e| AppError::HierarchyParse(e.to_string()))?
        {
            Event::Eof => break,
            Event::Start(e) if e.name().as_ref() == b"node" => {
                let node = build_node(&e, &mut next_index, &reader)?;
                stack.push(node);
            }
            Event::Empty(e) if e.name().as_ref() == b"node" => {
                let node = build_node(&e, &mut next_index, &reader)?;
                push_complete(node, &mut stack, &mut top_level);
            }
            Event::End(e) if e.name().as_ref() == b"node" => {
                if let Some(node) = stack.pop() {
                    push_complete(node, &mut stack, &mut top_level);
                }
            }
            _ => {}
        }
    }

    Ok(HierarchyTree {
        root: build_root(top_level, &mut next_index),
        xml_raw: xml.to_string(),
    })
}

fn push_complete(node: UINode, stack: &mut [UINode], top_level: &mut Vec<UINode>) {
    match stack.last_mut() {
        Some(parent) => parent.children.push(node),
        None => top_level.push(node),
    }
}

/// Collapse top-level siblings into a single root. If the dump only
/// had one top-level `<node>` (the classic UiAutomator fixture case),
/// return it as-is to preserve existing semantics and tests. Otherwise
/// synthesize a parent whose bounds span the union of the children,
/// so hit-testing and overlay scaling on the frontend still work.
fn build_root(children: Vec<UINode>, next_index: &mut usize) -> Option<UINode> {
    match children.len() {
        0 => None,
        1 => children.into_iter().next(),
        _ => {
            let bounds = children.iter().fold(
                Bounds {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                },
                |mut acc, c| {
                    if c.bounds.right > acc.right {
                        acc.right = c.bounds.right;
                    }
                    if c.bounds.bottom > acc.bottom {
                        acc.bottom = c.bounds.bottom;
                    }
                    acc
                },
            );
            let id = next_index.to_string();
            *next_index += 1;
            Some(UINode {
                id,
                resource_id: None,
                text: None,
                content_desc: None,
                class_name: "hierarchy".to_string(),
                package: String::new(),
                bounds,
                clickable: false,
                enabled: true,
                focused: false,
                children,
            })
        }
    }
}

fn build_node(
    e: &quick_xml::events::BytesStart<'_>,
    next_index: &mut usize,
    reader: &Reader<&[u8]>,
) -> AppResult<UINode> {
    let mut resource_id: Option<String> = None;
    let mut text: Option<String> = None;
    let mut content_desc: Option<String> = None;
    let mut class_name = String::new();
    let mut package = String::new();
    let mut bounds = Bounds {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    let mut clickable = false;
    let mut enabled = false;
    let mut focused = false;

    let decoder = reader.decoder();
    for attr in e.attributes().flatten() {
        let key = attr.key.as_ref();
        let value = attr
            .decode_and_unescape_value(decoder)
            .map_err(|err| AppError::HierarchyParse(err.to_string()))?;
        match key {
            // Note: we deliberately ignore the XML `index` attribute
            // here. UiAutomator dumps give every first-child node
            // `index="0"`, so it's *not* unique across the tree — using
            // it as the UINode id would collide between siblings at
            // different levels and break hover/selection hit-tests in
            // the inspector. The pre-order `next_index` counter below
            // matches what parse_maestro_json does and guarantees
            // uniqueness.
            b"resource-id" => resource_id = non_empty(&value),
            b"text" => text = non_empty(&value),
            b"content-desc" => content_desc = non_empty(&value),
            b"class" => class_name = value.to_string(),
            b"package" => package = value.to_string(),
            b"bounds" => {
                bounds = parse_bounds(&value)
                    .ok_or_else(|| AppError::HierarchyParse(format!("invalid bounds: {value}")))?
            }
            b"clickable" => clickable = value == "true",
            b"enabled" => enabled = value == "true",
            b"focused" => focused = value == "true",
            _ => {}
        }
    }

    let id = next_index.to_string();
    *next_index += 1;

    Ok(UINode {
        id,
        resource_id,
        text,
        content_desc,
        class_name,
        package,
        bounds,
        clickable,
        enabled,
        focused,
        children: Vec::new(),
    })
}

fn non_empty(s: &str) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
}

/// Parse a UIAutomator bounds string of the form "[l,t][r,b]".
pub fn parse_bounds(s: &str) -> Option<Bounds> {
    let bytes = s.as_bytes();
    if bytes.first() != Some(&b'[') {
        return None;
    }
    let mut nums: Vec<i32> = Vec::with_capacity(4);
    let mut current = String::new();
    for &b in bytes {
        match b {
            b'-' | b'0'..=b'9' => current.push(b as char),
            b',' | b']' if !current.is_empty() => {
                nums.push(current.parse().ok()?);
                current.clear();
            }
            _ => {}
        }
    }
    if nums.len() != 4 {
        return None;
    }
    Some(Bounds {
        left: nums[0],
        top: nums[1],
        right: nums[2],
        bottom: nums[3],
    })
}

/// Walk the tree and call `f` on every node (depth-first preorder).
pub fn walk<'a, F: FnMut(&'a UINode)>(node: &'a UINode, f: &mut F) {
    f(node);
    for child in &node.children {
        walk(child, f);
    }
}

/// Number of nodes in the tree (for tests / metrics).
pub fn count(tree: &HierarchyTree) -> usize {
    fn rec(n: &UINode) -> usize {
        1 + n.children.iter().map(rec).sum::<usize>()
    }
    tree.root.as_ref().map(rec).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SETTINGS_DUMP: &str = include_str!("../../tests/fixtures/settings_dump.xml");

    #[test]
    fn parses_bounds_simple() {
        let b = parse_bounds("[0,0][1080,2400]").unwrap();
        assert_eq!(b.left, 0);
        assert_eq!(b.top, 0);
        assert_eq!(b.right, 1080);
        assert_eq!(b.bottom, 2400);
    }

    #[test]
    fn parses_bounds_negative() {
        let b = parse_bounds("[-10,-20][100,200]").unwrap();
        assert_eq!(b.left, -10);
        assert_eq!(b.top, -20);
    }

    #[test]
    fn rejects_invalid_bounds() {
        assert!(parse_bounds("garbage").is_none());
        assert!(parse_bounds("[1,2]").is_none());
    }

    #[test]
    fn bounds_contains_point() {
        let b = Bounds {
            left: 10,
            top: 20,
            right: 100,
            bottom: 200,
        };
        assert!(b.contains(10, 20));
        assert!(b.contains(50, 50));
        assert!(!b.contains(100, 50));
        assert!(!b.contains(9, 50));
    }

    #[test]
    fn parses_settings_fixture() {
        let tree = parse_xml(SETTINGS_DUMP).expect("parse");
        let root = tree.root.as_ref().expect("root");
        assert_eq!(root.class_name, "android.widget.FrameLayout");
        assert_eq!(root.package, "com.android.settings");
        assert_eq!(root.bounds.right, 1080);
        assert!(count(&tree) >= 5);
    }

    #[test]
    fn extracts_text_and_resource_id() {
        let tree = parse_xml(SETTINGS_DUMP).expect("parse");
        let mut found_search = false;
        let mut found_wifi_text = false;
        walk(tree.root.as_ref().unwrap(), &mut |n| {
            if n.resource_id.as_deref() == Some("com.android.settings:id/search_action_bar") {
                found_search = true;
            }
            if n.text.as_deref() == Some("Wi-Fi") {
                found_wifi_text = true;
            }
        });
        assert!(found_search, "search bar resource-id missing");
        assert!(found_wifi_text, "Wi-Fi text missing");
    }

    #[test]
    fn parses_clickable_flag() {
        let tree = parse_xml(SETTINGS_DUMP).expect("parse");
        let mut clickable_count = 0;
        walk(tree.root.as_ref().unwrap(), &mut |n| {
            if n.clickable {
                clickable_count += 1;
            }
        });
        assert!(clickable_count >= 2);
    }

    #[test]
    fn empty_xml_returns_no_root() {
        let tree =
            parse_xml("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<hierarchy/>").expect("parse");
        assert!(tree.root.is_none());
    }

    #[test]
    fn truncated_xml_errors() {
        // Unclosed tag — quick-xml flags this on read.
        let res = parse_xml("<hierarchy><node bounds=\"[0,0][1,1]\" class=\"X\" package=\"p\"");
        assert!(res.is_err());
    }

    #[test]
    fn parses_maestro_json_output() {
        let json = r#"{
            "attributes": {
                "bounds": "[0,0][1080,2400]",
                "class": "android.widget.FrameLayout",
                "package": "com.x",
                "resource-id": "",
                "text": "",
                "clickable": "false",
                "enabled": "true"
            },
            "children": [
                {
                    "attributes": {
                        "bounds": "[100,200][500,300]",
                        "class": "androidx.compose.ui.platform.ComposeView",
                        "package": "com.x",
                        "resource-id": "com.x:id/btn",
                        "text": "Sign in",
                        "clickable": "true",
                        "enabled": "true"
                    },
                    "children": []
                }
            ]
        }"#;
        let tree = parse_maestro_json(json).expect("parse");
        let root = tree.root.as_ref().expect("root");
        assert_eq!(root.class_name, "android.widget.FrameLayout");
        assert_eq!(root.bounds.right, 1080);
        assert_eq!(root.children.len(), 1);
        let btn = &root.children[0];
        assert_eq!(btn.text.as_deref(), Some("Sign in"));
        assert_eq!(btn.resource_id.as_deref(), Some("com.x:id/btn"));
        assert!(btn.clickable);
    }

    #[test]
    fn parses_maestro_json_with_log_prefix() {
        // Maestro CLI sometimes prints status lines before the JSON payload.
        let raw = "Setting up Maestro on device...\nDone\n{\
            \"attributes\":{\"bounds\":\"[0,0][10,10]\",\"class\":\"View\",\"package\":\"p\"},\
            \"children\":[]}";
        let tree = parse_maestro_json(raw).expect("parse");
        assert!(tree.root.is_some());
    }
}
