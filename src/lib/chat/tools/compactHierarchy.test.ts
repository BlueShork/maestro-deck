// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import type { UINode, HierarchyTree } from "@/types";
import { compactHierarchy } from "./compactHierarchy";

// Fixture helper: node(partial) fills defaults
function node(partial: Partial<UINode>): UINode {
  return {
    id: partial.id ?? "node-1",
    resource_id: partial.resource_id ?? null,
    text: partial.text ?? null,
    content_desc: partial.content_desc ?? null,
    class_name: partial.class_name ?? "android.widget.FrameLayout",
    package: partial.package ?? "com.example",
    bounds: partial.bounds ?? { left: 0, top: 0, right: 100, bottom: 100 },
    clickable: partial.clickable ?? false,
    enabled: partial.enabled ?? true,
    focused: partial.focused ?? false,
    children: partial.children ?? [],
  };
}

describe("compactHierarchy", () => {
  // Case 1: empty tree → "(empty hierarchy)"
  it("case 1: empty tree returns empty hierarchy message", () => {
    const tree: HierarchyTree = { root: null, xml_raw: "" };
    expect(compactHierarchy(tree)).toBe("(empty hierarchy)");
  });

  // Case 2: boring wrapper chain is pruned and useful leaf hoisted to depth 0
  it("case 2: boring wrapper is pruned, useful leaf hoisted to depth 0", () => {
    const leaf = node({
      id: "leaf",
      text: "Useful Text",
      class_name: "android.widget.TextView",
    });
    const wrapper = node({
      id: "wrapper",
      children: [leaf],
    });
    const tree: HierarchyTree = { root: wrapper, xml_raw: "" };
    const result = compactHierarchy(tree);
    // Wrapper is boring (no text/desc/id, not clickable/focused), so leaf hoists to depth 0
    expect(result).toContain("TextView");
    expect(result).toContain("Useful Text");
    expect(result).not.toMatch(/^ {2}/); // No leading spaces
  });

  // Case 3: clickable button renders with text, id, bounds, clickable
  it("case 3: clickable button renders with text, id, bounds, clickable", () => {
    const button = node({
      id: "btn-ok",
      text: "OK",
      resource_id: "btn_submit",
      class_name: "android.widget.Button",
      clickable: true,
      bounds: { left: 10, top: 20, right: 110, bottom: 70 },
    });
    const tree: HierarchyTree = { root: button, xml_raw: "" };
    const result = compactHierarchy(tree);
    expect(result).toContain("Button");
    expect(result).toContain("OK");
    expect(result).toContain("btn_submit");
    expect(result).toContain("clickable");
    expect(result).toMatch(/bounds \[\d+,\d+,\d+,\d+\]/);
  });

  // Case 4: bounds are [left,top,width,height]
  it("case 4: bounds format is [left,top,width,height]", () => {
    const node1 = node({
      id: "node-bounds",
      text: "Test",
      bounds: { left: 10, top: 20, right: 110, bottom: 120 },
    });
    const tree: HierarchyTree = { root: node1, xml_raw: "" };
    const result = compactHierarchy(tree);
    // width = 110 - 10 = 100, height = 120 - 20 = 100
    expect(result).toContain("bounds [10,20,100,100]");
  });

  // Case 5: child of a kept node indents by two spaces
  it("case 5: child of kept node indents by two spaces", () => {
    const child = node({
      id: "child",
      text: "Child Text",
      class_name: "android.widget.TextView",
    });
    const parent = node({
      id: "parent",
      text: "Parent Text",
      class_name: "android.widget.LinearLayout",
      children: [child],
    });
    const tree: HierarchyTree = { root: parent, xml_raw: "" };
    const result = compactHierarchy(tree);
    const lines = result.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).not.toMatch(/^ {2}/); // Parent at depth 0
    expect(lines[1]).toMatch(/^ {2}/); // Child indented by 2 spaces
    expect(lines[1]).not.toMatch(/^ {4}/); // Exactly 2 spaces, not 4
  });

  // Case 6: disabled node renders "disabled"; all-boring tree → "(no interesting nodes)"
  it("case 6a: disabled node renders disabled flag", () => {
    const disabledBtn = node({
      id: "disabled-btn",
      text: "Disabled",
      class_name: "android.widget.Button",
      enabled: false,
    });
    const tree: HierarchyTree = { root: disabledBtn, xml_raw: "" };
    const result = compactHierarchy(tree);
    expect(result).toContain("disabled");
  });

  it("case 6b: all-boring tree returns no interesting nodes message", () => {
    const boringChild = node({ id: "boring-child" });
    const boringParent = node({ id: "boring-parent", children: [boringChild] });
    const tree: HierarchyTree = { root: boringParent, xml_raw: "" };
    expect(compactHierarchy(tree)).toBe("(no interesting nodes)");
  });
});
