//! R-tree spatial index + selector ranking. Stub — agent fills in (plan §4 Phase 4).
use crate::hierarchy::UINode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Selector {
    ResourceId { value: String },
    Text { value: String },
    ContentDesc { value: String },
    Point { x_pct: f32, y_pct: f32 },
}

#[derive(Debug, Default)]
pub struct SpatialIndex;

impl SpatialIndex {
    pub fn build(_root: &UINode) -> Self {
        Self
    }

    pub fn find_at(&self, _x: i32, _y: i32) -> Option<UINode> {
        None
    }
}

pub fn suggest_selectors(_node: &UINode) -> Vec<Selector> {
    Vec::new()
}
