//! R-tree spatial index + selector ranking.

use rstar::{RTree, RTreeObject, AABB};
use serde::{Deserialize, Serialize};

use crate::hierarchy::{Bounds, UINode};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Selector {
    ResourceId { value: String },
    Text { value: String },
    ContentDesc { value: String },
    Point { x_pct: f32, y_pct: f32 },
}

#[derive(Debug, Clone)]
struct IndexedNode {
    node: UINode,
    bounds: Bounds,
}

impl RTreeObject for IndexedNode {
    type Envelope = AABB<[i32; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.bounds.left, self.bounds.top],
            [self.bounds.right, self.bounds.bottom],
        )
    }
}

#[derive(Debug, Default)]
pub struct SpatialIndex {
    tree: RTree<IndexedNode>,
    /// Optional viewport size for `Point` selector normalization.
    pub viewport: Option<(i32, i32)>,
}

impl SpatialIndex {
    pub fn build(root: &UINode) -> Self {
        let mut entries: Vec<IndexedNode> = Vec::new();
        collect(root, &mut entries);
        Self {
            tree: RTree::bulk_load(entries),
            viewport: None,
        }
    }

    pub fn with_viewport(mut self, w: i32, h: i32) -> Self {
        self.viewport = Some((w, h));
        self
    }

    /// Returns the most relevant node whose bounds contain (x, y). Prefer
    /// nodes with a usable selector (text / resource-id / content-desc /
    /// clickable) picking the smallest among those; otherwise fall back to
    /// the raw smallest-area containing node.
    pub fn find_at(&self, x: i32, y: i32) -> Option<UINode> {
        let pt = AABB::from_point([x, y]);
        let mut best_targetable: Option<&IndexedNode> = None;
        let mut best_any: Option<&IndexedNode> = None;
        for candidate in self.tree.locate_in_envelope_intersecting(&pt) {
            if !candidate.bounds.contains(x, y) {
                continue;
            }
            best_any = Some(match best_any {
                None => candidate,
                Some(prev) if candidate.bounds.area() < prev.bounds.area() => candidate,
                Some(prev) => prev,
            });
            if is_targetable(&candidate.node) {
                best_targetable = Some(match best_targetable {
                    None => candidate,
                    Some(prev) if candidate.bounds.area() < prev.bounds.area() => candidate,
                    Some(prev) => prev,
                });
            }
        }
        best_targetable
            .or(best_any)
            .map(|c| c.node.clone())
    }
}

fn is_targetable(n: &UINode) -> bool {
    n.text.as_deref().is_some_and(|t| !t.is_empty())
        || n.resource_id.as_deref().is_some_and(|r| !r.is_empty())
        || n.content_desc.as_deref().is_some_and(|d| !d.is_empty())
        || n.clickable
}

fn collect(node: &UINode, out: &mut Vec<IndexedNode>) {
    out.push(IndexedNode {
        node: UINode {
            children: Vec::new(),
            ..node.clone()
        },
        bounds: node.bounds,
    });
    for child in &node.children {
        collect(child, out);
    }
}

/// Suggest selectors for a node, ordered by robustness:
/// resource-id > text > content-desc > point fallback.
pub fn suggest_selectors(node: &UINode) -> Vec<Selector> {
    suggest_selectors_with_viewport(node, None)
}

pub fn suggest_selectors_with_viewport(
    node: &UINode,
    viewport: Option<(i32, i32)>,
) -> Vec<Selector> {
    let mut out: Vec<Selector> = Vec::new();

    if let Some(rid) = node.resource_id.as_ref().filter(|s| !s.is_empty()) {
        out.push(Selector::ResourceId { value: rid.clone() });
    }
    if let Some(text) = node.text.as_ref().filter(|s| !s.is_empty()) {
        out.push(Selector::Text {
            value: text.clone(),
        });
    }
    if let Some(desc) = node.content_desc.as_ref().filter(|s| !s.is_empty()) {
        out.push(Selector::ContentDesc {
            value: desc.clone(),
        });
    }

    let (w, h) = viewport.unwrap_or((
        // fall back to bounds extent for normalization (works for any concrete value)
        node.bounds.right.max(1),
        node.bounds.bottom.max(1),
    ));
    let cx = (node.bounds.left + node.bounds.right) / 2;
    let cy = (node.bounds.top + node.bounds.bottom) / 2;
    let xp = ((cx as f32 / w as f32) * 100.0).clamp(0.0, 100.0);
    let yp = ((cy as f32 / h as f32) * 100.0).clamp(0.0, 100.0);
    out.push(Selector::Point {
        x_pct: xp,
        y_pct: yp,
    });

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hierarchy::parse_xml;

    const SETTINGS_DUMP: &str = include_str!("../../tests/fixtures/settings_dump.xml");

    fn fixture_root() -> UINode {
        parse_xml(SETTINGS_DUMP).unwrap().root.unwrap()
    }

    #[test]
    fn ranks_resource_id_first() {
        let node = UINode {
            id: "x".into(),
            resource_id: Some("com.x:id/btn".into()),
            text: Some("Hello".into()),
            content_desc: Some("desc".into()),
            class_name: "Button".into(),
            package: "p".into(),
            bounds: Bounds {
                left: 0,
                top: 0,
                right: 100,
                bottom: 100,
            },
            clickable: true,
            enabled: true,
            focused: false,
            children: vec![],
        };
        let s = suggest_selectors(&node);
        assert!(matches!(s[0], Selector::ResourceId { .. }));
        assert!(matches!(s[1], Selector::Text { .. }));
        assert!(matches!(s[2], Selector::ContentDesc { .. }));
        assert!(matches!(s[3], Selector::Point { .. }));
    }

    #[test]
    fn skips_missing_attrs() {
        let node = UINode {
            id: "x".into(),
            resource_id: None,
            text: None,
            content_desc: Some("only-desc".into()),
            class_name: "View".into(),
            package: "p".into(),
            bounds: Bounds {
                left: 0,
                top: 0,
                right: 50,
                bottom: 50,
            },
            clickable: false,
            enabled: true,
            focused: false,
            children: vec![],
        };
        let s = suggest_selectors(&node);
        assert_eq!(s.len(), 2);
        assert!(matches!(s[0], Selector::ContentDesc { .. }));
        assert!(matches!(s[1], Selector::Point { .. }));
    }

    #[test]
    fn point_fallback_uses_viewport() {
        let node = UINode {
            id: "x".into(),
            resource_id: None,
            text: None,
            content_desc: None,
            class_name: "View".into(),
            package: "p".into(),
            bounds: Bounds {
                left: 100,
                top: 100,
                right: 300,
                bottom: 300,
            },
            clickable: false,
            enabled: true,
            focused: false,
            children: vec![],
        };
        let s = suggest_selectors_with_viewport(&node, Some((400, 400)));
        match &s[0] {
            Selector::Point { x_pct, y_pct } => {
                assert!((*x_pct - 50.0).abs() < 0.1);
                assert!((*y_pct - 50.0).abs() < 0.1);
            }
            other => panic!("expected Point, got {other:?}"),
        }
    }

    #[test]
    fn rtree_finds_smallest_containing() {
        let root = fixture_root();
        let idx = SpatialIndex::build(&root);
        // Center of the "Wi-Fi" text bounds [120,340][800,400] = (460, 370)
        let hit = idx.find_at(460, 370).expect("hit");
        assert_eq!(hit.text.as_deref(), Some("Wi-Fi"));
    }

    #[test]
    fn rtree_returns_none_outside() {
        let root = fixture_root();
        let idx = SpatialIndex::build(&root);
        assert!(idx.find_at(99999, 99999).is_none());
    }

    #[test]
    fn rtree_finds_battery_entry() {
        let root = fixture_root();
        let idx = SpatialIndex::build(&root);
        // Center of "87%" summary [120,810][800,870] = (460, 840)
        let hit = idx.find_at(460, 840).expect("hit");
        assert_eq!(hit.text.as_deref(), Some("87%"));
    }
}
