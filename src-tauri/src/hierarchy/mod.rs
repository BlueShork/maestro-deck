//! UIAutomator hierarchy dump + parse.

use std::path::PathBuf;

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::device::adb;
use crate::error::{AppError, AppResult};

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

const REMOTE_DUMP_PATH: &str = "/sdcard/window_dump.xml";

pub fn dump_hierarchy(serial: &str) -> AppResult<HierarchyTree> {
    adb::exec_shell(serial, &format!("uiautomator dump {}", REMOTE_DUMP_PATH))?;

    let tmp = std::env::temp_dir().join(format!("maestro-deck-dump-{}.xml", serial));
    let tmp_str = tmp
        .to_str()
        .ok_or_else(|| AppError::Other("temp path is not utf-8".into()))?;
    adb::pull(serial, REMOTE_DUMP_PATH, tmp_str)?;

    let xml = std::fs::read_to_string(&tmp).map_err(AppError::Io)?;
    // Best-effort cleanup; ignore failure.
    let _ = std::fs::remove_file(&tmp);
    debug!(bytes = xml.len(), "hierarchy XML pulled");
    parse_xml(&xml)
}

/// Parse a UIAutomator XML dump into a tree.
pub fn parse_xml(xml: &str) -> AppResult<HierarchyTree> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<UINode> = Vec::new();
    let mut root: Option<UINode> = None;
    let mut next_index: usize = 0;

    loop {
        match reader
            .read_event()
            .map_err(|e| AppError::HierarchyParse(e.to_string()))?
        {
            Event::Eof => break,
            Event::Start(e) => {
                if e.name().as_ref() == b"node" {
                    let node = build_node(&e, &mut next_index, &reader)?;
                    stack.push(node);
                }
            }
            Event::Empty(e) => {
                if e.name().as_ref() == b"node" {
                    let node = build_node(&e, &mut next_index, &reader)?;
                    push_complete(node, &mut stack, &mut root);
                }
            }
            Event::End(e) => {
                if e.name().as_ref() == b"node" {
                    if let Some(node) = stack.pop() {
                        push_complete(node, &mut stack, &mut root);
                    }
                }
            }
            _ => {}
        }
    }

    Ok(HierarchyTree {
        root,
        xml_raw: xml.to_string(),
    })
}

fn push_complete(node: UINode, stack: &mut [UINode], root: &mut Option<UINode>) {
    match stack.last_mut() {
        Some(parent) => parent.children.push(node),
        None => *root = Some(node),
    }
}

fn build_node(
    e: &quick_xml::events::BytesStart<'_>,
    next_index: &mut usize,
    reader: &Reader<&[u8]>,
) -> AppResult<UINode> {
    let mut id = String::new();
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
            b"index" => id = value.to_string(),
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

    if id.is_empty() {
        id = next_index.to_string();
    }
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
            b',' | b']' => {
                if !current.is_empty() {
                    nums.push(current.parse().ok()?);
                    current.clear();
                }
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

/// Used by tests / debugging to look at where the dump landed before parsing.
#[allow(dead_code)]
pub(crate) fn remote_dump_path() -> PathBuf {
    PathBuf::from(REMOTE_DUMP_PATH)
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
}
