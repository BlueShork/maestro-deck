// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web hierarchy: Maestro Studio's `device-screen` SSE event carries a **flat
//! list** of elements (`{id, bounds:{x,y,width,height}, resourceId?, text?}`),
//! not the nested `{attributes, children}` TreeNode the mobile drivers emit.
//! We wrap that list under a synthetic root so the existing R-tree,
//! hit-testing, overlay, and selector ranking work unchanged.

use serde::Deserialize;

use crate::error::{AppError, AppResult};
use crate::hierarchy::{Bounds, HierarchyTree, UINode};

#[derive(Debug, Deserialize)]
struct WebBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[derive(Debug, Deserialize)]
struct WebElement {
    bounds: WebBounds,
    #[serde(rename = "resourceId")]
    resource_id: Option<String>,
    text: Option<String>,
}

fn web_element_to_node(e: WebElement, id: usize) -> UINode {
    UINode {
        id: id.to_string(),
        resource_id: e.resource_id.filter(|s| !s.is_empty()),
        text: e.text.filter(|s| !s.is_empty()),
        content_desc: None,
        class_name: String::new(),
        package: String::new(),
        bounds: Bounds {
            left: e.bounds.x,
            top: e.bounds.y,
            right: e.bounds.x + e.bounds.width,
            bottom: e.bounds.y + e.bounds.height,
        },
        // The web driver doesn't report interactivity/state per element.
        clickable: false,
        enabled: true,
        focused: false,
        children: Vec::new(),
    }
}

/// Union of all child bounds — the synthetic root must contain every element so
/// `SpatialIndex` hit-testing resolves to the smallest enclosing element.
fn bounding_box(nodes: &[UINode]) -> Bounds {
    if nodes.is_empty() {
        return Bounds {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
    }
    Bounds {
        left: nodes.iter().map(|n| n.bounds.left).min().unwrap_or(0),
        top: nodes.iter().map(|n| n.bounds.top).min().unwrap_or(0),
        right: nodes.iter().map(|n| n.bounds.right).max().unwrap_or(0),
        bottom: nodes.iter().map(|n| n.bounds.bottom).max().unwrap_or(0),
    }
}

/// Convert the `elements` array from a device-screen event into a
/// `HierarchyTree`: a synthetic root whose children are the flat elements.
pub fn parse_device_screen_hierarchy(elements: &serde_json::Value) -> AppResult<HierarchyTree> {
    let els: Vec<WebElement> = serde_json::from_value(elements.clone())
        .map_err(|e| AppError::HierarchyParse(format!("web elements parse: {e}")))?;
    // Root takes index 0; children follow in document order.
    let children: Vec<UINode> = els
        .into_iter()
        .enumerate()
        .map(|(i, e)| web_element_to_node(e, i + 1))
        .collect();
    let root = UINode {
        id: "0".to_string(),
        resource_id: None,
        text: None,
        content_desc: None,
        class_name: "Document".to_string(),
        package: String::new(),
        bounds: bounding_box(&children),
        clickable: false,
        enabled: true,
        focused: false,
        children,
    };
    Ok(HierarchyTree {
        root: Some(root),
        xml_raw: elements.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_flat_web_elements() {
        let v = serde_json::json!([
            {"id":"0,0,1200,64","bounds":{"x":0,"y":0,"width":1200,"height":64}},
            {"id":"Search-Search…","bounds":{"x":413,"y":14,"width":338,"height":37},"resourceId":"Search","text":"Search…"}
        ]);
        let tree = parse_device_screen_hierarchy(&v).expect("parse");
        let root = tree.root.expect("root");
        assert_eq!(root.children.len(), 2);
        // Root must enclose every element.
        assert_eq!(root.bounds.right, 1200);

        let search = &root.children[1];
        assert_eq!(search.resource_id.as_deref(), Some("Search"));
        assert_eq!(search.text.as_deref(), Some("Search…"));
        assert_eq!(
            search.bounds,
            Bounds {
                left: 413,
                top: 14,
                right: 751,
                bottom: 51
            }
        );
    }

    #[test]
    fn empty_elements_yield_empty_root() {
        let tree = parse_device_screen_hierarchy(&serde_json::json!([])).expect("parse");
        let root = tree.root.expect("root");
        assert!(root.children.is_empty());
        assert_eq!(root.bounds.area(), 0);
    }
}
