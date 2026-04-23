//! UIAutomator hierarchy dump + parse. Stub — agent fills in (plan §4 Phase 4).
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bounds {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Default)]
pub struct HierarchyTree {
    pub root: Option<UINode>,
    pub xml_raw: String,
}

pub fn dump_hierarchy(_serial: &str) -> AppResult<HierarchyTree> {
    Ok(HierarchyTree::default())
}

pub fn parse_xml(_xml: &str) -> AppResult<HierarchyTree> {
    Ok(HierarchyTree::default())
}
