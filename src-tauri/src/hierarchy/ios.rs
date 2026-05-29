// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Parse the iOS XCTest `/viewHierarchy` JSON (`AXElement` tree) into the
//! shared `HierarchyTree`/`UINode`, matching Maestro's IOSDriver field mapping.

use serde::Deserialize;

use super::{Bounds, HierarchyTree, UINode};
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
struct AxFrame {
    #[serde(rename = "X", default)]
    x: f64,
    #[serde(rename = "Y", default)]
    y: f64,
    #[serde(rename = "Width", default)]
    w: f64,
    #[serde(rename = "Height", default)]
    h: f64,
}

#[derive(Debug, Deserialize)]
struct AxElement {
    #[serde(default)]
    identifier: Option<String>,
    #[serde(default)]
    frame: Option<AxFrame>,
    #[serde(default)]
    value: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    label: Option<String>,
    #[serde(rename = "elementType", default)]
    element_type: i64,
    #[serde(default)]
    enabled: Option<bool>,
    #[serde(rename = "hasFocus", default)]
    has_focus: Option<bool>,
    #[serde(default)]
    children: Vec<AxElement>,
}

/// XCUIElement.ElementType raw values (subset) considered tappable.
/// Heuristic for `clickable`, since iOS has no clickable flag.
fn is_interactive(element_type: i64) -> bool {
    matches!(element_type, 9 | 10 | 12 | 13 | 33 | 34 | 35 | 53 | 56 | 58)
}

/// Human-readable class name for a subset of XCUIElement.ElementType values.
fn element_type_name(t: i64) -> &'static str {
    match t {
        0 => "Any",
        1 => "Other",
        2 => "Application",
        9 => "Button",
        33 => "Link",
        48 => "StaticText",
        49 => "TextField",
        50 => "SecureTextField",
        56 => "Switch",
        _ => "Element",
    }
}

fn non_empty(s: Option<String>) -> Option<String> {
    s.filter(|v| !v.is_empty())
}

fn convert(node: AxElement, next_index: &mut usize) -> UINode {
    let f = node.frame.unwrap_or(AxFrame {
        x: 0.0,
        y: 0.0,
        w: 0.0,
        h: 0.0,
    });
    let bounds = Bounds {
        left: f.x.round() as i32,
        top: f.y.round() as i32,
        right: (f.x + f.w).round() as i32,
        bottom: (f.y + f.h).round() as i32,
    };
    let id = next_index.to_string();
    *next_index += 1;

    // text = title if non-empty, else value (Maestro IOSDriver semantics).
    let text = non_empty(node.title).or_else(|| non_empty(node.value));

    let children = node
        .children
        .into_iter()
        .map(|c| convert(c, next_index))
        .collect();

    UINode {
        id,
        resource_id: non_empty(node.identifier),
        text,
        content_desc: non_empty(node.label),
        class_name: element_type_name(node.element_type).to_string(),
        package: String::new(),
        bounds,
        clickable: node.enabled.unwrap_or(true) && is_interactive(node.element_type),
        enabled: node.enabled.unwrap_or(true),
        focused: node.has_focus.unwrap_or(false),
        children,
    }
}

/// v2.5.1 wraps the tree as `{ "depth": N, "axElement": { … } }`. `axElement`
/// is required, so this only deserializes the wrapped shape (a bare AXElement
/// has no `axElement` key and falls through to the legacy path below).
#[derive(Debug, Deserialize)]
struct ViewHierarchyResponse {
    #[serde(rename = "axElement")]
    ax_element: AxElement,
}

/// Parse the `/viewHierarchy` JSON. The runner may prefix log lines, so we
/// locate the first `{` like `parse_maestro_json` does.
pub fn parse_ios_axelement(raw: &str) -> AppResult<HierarchyTree> {
    let start = raw
        .find('{')
        .ok_or_else(|| AppError::HierarchyParse("no JSON object in viewHierarchy output".into()))?;
    let json = &raw[start..];
    // Prefer the v2.5.1 wrapper `{depth, axElement}`; fall back to a bare
    // AXElement for older runners. AXElement fields all default, so the wrapper
    // would otherwise silently parse into an empty root (0 targetable nodes).
    let root: AxElement = match serde_json::from_str::<ViewHierarchyResponse>(json) {
        Ok(resp) => resp.ax_element,
        Err(_) => serde_json::from_str(json)
            .map_err(|e| AppError::HierarchyParse(format!("AXElement parse error: {e}")))?,
    };
    let mut next_index = 0usize;
    Ok(HierarchyTree {
        root: Some(convert(root, &mut next_index)),
        xml_raw: raw.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hierarchy::walk;

    const FIXTURE: &str = include_str!("../../tests/fixtures/ios_hierarchy.json");

    #[test]
    fn maps_axelement_fields_to_uinode() {
        let tree = parse_ios_axelement(FIXTURE).expect("parse");
        let root = tree.root.as_ref().expect("root");
        assert_eq!(root.bounds.right, 393);
        assert_eq!(root.bounds.bottom, 852);
        assert_eq!(root.children.len(), 2);

        let mut login = None;
        let mut welcome = None;
        walk(root, &mut |n| {
            if n.resource_id.as_deref() == Some("login_button") {
                login = Some(n.clone());
            }
            if n.text.as_deref() == Some("Welcome") {
                welcome = Some(n.clone());
            }
        });

        let login = login.expect("login node");
        assert_eq!(login.resource_id.as_deref(), Some("login_button"));
        assert_eq!(login.content_desc.as_deref(), Some("Log in"));
        assert_eq!(login.bounds.left, 20);
        assert_eq!(login.bounds.right, 373);
        assert!(login.enabled);
        // elementType 9 (Button) is interactive → clickable.
        assert!(login.clickable);

        let welcome = welcome.expect("welcome node");
        assert_eq!(welcome.text.as_deref(), Some("Welcome"));
        assert_eq!(welcome.class_name, "StaticText");
        // elementType 48 (StaticText) is not interactive → not clickable.
        assert!(!welcome.clickable);
    }

    #[test]
    fn unwraps_v251_depth_axelement_envelope() {
        // v2.5.1 wraps the tree in `{depth, axElement}`; the real content must
        // be unwrapped, not parsed as a (defaulted, empty) AXElement.
        let json = r#"{"depth":24,"axElement":{"identifier":"root","frame":{"X":0,"Y":0,"Width":100,"Height":200},"elementType":0,"children":[{"identifier":"btn","frame":{"X":0,"Y":0,"Width":50,"Height":20},"title":"Go","elementType":9,"enabled":true,"children":[]}]}}"#;
        let tree = parse_ios_axelement(json).expect("parse");
        let root = tree.root.expect("root");
        assert_eq!(root.bounds.right, 100);
        assert_eq!(root.children.len(), 1);
        assert_eq!(root.children[0].text.as_deref(), Some("Go"));
    }

    #[test]
    fn text_falls_back_to_value_when_title_empty() {
        let json = r#"{"identifier":"f","frame":{"X":0,"Y":0,"Width":10,"Height":10},
            "title":"","value":"typed","label":"","elementType":49,"enabled":true,"children":[]}"#;
        let tree = parse_ios_axelement(json).expect("parse");
        assert_eq!(tree.root.unwrap().text.as_deref(), Some("typed"));
    }
}
