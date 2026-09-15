// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { HierarchyTree, UINode } from "@/types";

function interesting(n: UINode): boolean {
  return Boolean(
    (n.text && n.text.trim()) ||
    (n.content_desc && n.content_desc.trim()) ||
    n.resource_id ||
    n.clickable ||
    n.focused,
  );
}

function hasInterestingDescendant(n: UINode): boolean {
  return n.children.some((c) => interesting(c) || hasInterestingDescendant(c));
}

function shortClass(className: string): string {
  const last = className.split(".").pop() ?? className;
  return last || "View";
}

function renderNode(n: UINode, depth: number, out: string[]): void {
  const keep = interesting(n);
  if (keep) {
    const b = n.bounds;
    const parts: string[] = [shortClass(n.class_name)];
    if (n.text?.trim()) parts.push(`text ${JSON.stringify(n.text.trim())}`);
    if (n.content_desc?.trim()) parts.push(`desc ${JSON.stringify(n.content_desc.trim())}`);
    if (n.resource_id) parts.push(`id ${JSON.stringify(n.resource_id)}`);
    parts.push(`bounds [${b.left},${b.top},${b.right - b.left},${b.bottom - b.top}]`);
    if (n.clickable) parts.push("clickable");
    if (n.focused) parts.push("focused");
    if (!n.enabled) parts.push("disabled");
    out.push("  ".repeat(depth) + parts.join(" "));
  }
  // Pruned nodes don't indent their children — the tree stays shallow.
  const childDepth = keep ? depth + 1 : depth;
  for (const c of n.children) {
    if (interesting(c) || hasInterestingDescendant(c)) renderNode(c, childDepth, out);
  }
}

/** Compact, token-cheap text rendering of the view hierarchy. Nodes with no
 *  text/desc/id and no interactive state are pruned (their useful children
 *  are hoisted up one level). */
export function compactHierarchy(tree: HierarchyTree): string {
  if (!tree.root) return "(empty hierarchy)";
  const out: string[] = [];
  renderNode(tree.root, 0, out);
  return out.length ? out.join("\n") : "(no interesting nodes)";
}
