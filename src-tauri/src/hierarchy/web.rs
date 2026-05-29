// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Web hierarchy: the Maestro Studio device-screen response carries the view
//! hierarchy as the same TreeNode JSON (`{attributes, children}`) that the
//! `maestro hierarchy` CLI emits, so we delegate to `parse_maestro_json`.

use crate::error::{AppError, AppResult};
use crate::hierarchy::{parse_maestro_json, HierarchyTree};

/// Convert the `elements` value from `GET /api/device-screen` into a
/// `HierarchyTree`. VERIFY (Task 1): if `elements` is a *list* of roots rather
/// than a single root object, wrap it under a synthetic root here before
/// delegating (mirror `build_root` semantics).
pub fn parse_device_screen_hierarchy(elements: &serde_json::Value) -> AppResult<HierarchyTree> {
    let json = serde_json::to_string(elements)
        .map_err(|e| AppError::HierarchyParse(format!("web hierarchy reserialize: {e}")))?;
    parse_maestro_json(&json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_treenode_value() {
        let v = serde_json::json!({
            "attributes": { "text": "Sign in", "bounds": "[0,0][100,40]" },
            "children": []
        });
        let tree = parse_device_screen_hierarchy(&v).expect("parse");
        let root = tree.root.expect("root");
        assert_eq!(root.text.as_deref(), Some("Sign in"));
    }
}
