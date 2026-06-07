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
///
/// `viewport` is the device-screen event's reported `(width, height)` in CSS
/// pixels — the true coordinate space the element bounds live in. The root is
/// sized to that viewport (not the bounding box of the detected elements) so
/// the overlay's coordinate-space auto-detection — which reads the max bounds
/// in the tree — recovers the real viewport rather than a tight union that
/// usually falls short of the screen edges (e.g. 960×232 for a sparse page in
/// a 1200×766 viewport), which otherwise stretches the inspector overlay. When
/// the viewport is unknown (either dimension 0) we fall back to the union.
pub fn parse_device_screen_hierarchy(
    elements: &serde_json::Value,
    viewport: (u32, u32),
) -> AppResult<HierarchyTree> {
    let els: Vec<WebElement> = serde_json::from_value(elements.clone())
        .map_err(|e| AppError::HierarchyParse(format!("web elements parse: {e}")))?;
    // Root takes index 0; children follow in document order.
    let children: Vec<UINode> = els
        .into_iter()
        .enumerate()
        .map(|(i, e)| web_element_to_node(e, i + 1))
        .collect();
    let root_bounds = match viewport {
        (w, h) if w > 0 && h > 0 => Bounds {
            left: 0,
            top: 0,
            right: w as i32,
            bottom: h as i32,
        },
        _ => bounding_box(&children),
    };
    let root = UINode {
        id: "0".to_string(),
        resource_id: None,
        text: None,
        content_desc: None,
        class_name: "Document".to_string(),
        package: String::new(),
        bounds: root_bounds,
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
        let tree = parse_device_screen_hierarchy(&v, (1200, 766)).expect("parse");
        let root = tree.root.expect("root");
        assert_eq!(root.children.len(), 2);
        // Root spans the reported viewport (not the tight union of children) so
        // the overlay's coordinate-space detection recovers the real screen.
        assert_eq!(root.bounds.right, 1200);
        assert_eq!(root.bounds.bottom, 766);

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
    fn root_spans_viewport_not_union_when_elements_are_sparse() {
        // Regression: a sparse page (content clustered top-left) used to size
        // the root to the union of bounds (here 960×232), which stretched the
        // inspector overlay. The root must instead span the reported viewport.
        let v = serde_json::json!([
            {"bounds":{"x":240,"y":115,"width":720,"height":28},"text":"Example Domain"},
            {"bounds":{"x":240,"y":213,"width":82,"height":19},"text":"Learn more"}
        ]);
        let tree = parse_device_screen_hierarchy(&v, (1200, 766)).expect("parse");
        let root = tree.root.expect("root");
        // Union would be 960×232; viewport is 1200×766.
        assert_eq!(root.bounds.right, 1200);
        assert_eq!(root.bounds.bottom, 766);
    }

    #[test]
    fn unknown_viewport_falls_back_to_union() {
        // Either dimension 0 → we can't trust the viewport, so the root falls
        // back to enclosing the elements (the prior behaviour).
        let v = serde_json::json!([
            {"bounds":{"x":0,"y":0,"width":300,"height":50}}
        ]);
        let tree = parse_device_screen_hierarchy(&v, (0, 0)).expect("parse");
        let root = tree.root.expect("root");
        assert_eq!(root.bounds.right, 300);
        assert_eq!(root.bounds.bottom, 50);
    }

    #[test]
    fn empty_elements_yield_empty_root() {
        let tree = parse_device_screen_hierarchy(&serde_json::json!([]), (0, 0)).expect("parse");
        let root = tree.root.expect("root");
        assert!(root.children.is_empty());
        assert_eq!(root.bounds.area(), 0);
    }
}
