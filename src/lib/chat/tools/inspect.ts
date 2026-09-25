// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ipc } from "@/lib/ipc";
import { useDeviceStore } from "@/stores/deviceStore";
import type { Selector, UINode } from "@/types";
import type { ToolSpec } from "@/types/chat";

function requireDevice() {
  const device = useDeviceStore.getState().current;
  if (!device) throw new Error("No device connected — ask the user to connect one first.");
  return device;
}

function shortClass(className: string): string {
  const last = className.split(".").pop() ?? className;
  return last || "View";
}

function renderSelector(s: Selector): string {
  switch (s.kind) {
    case "resourceId":
      return `id: ${JSON.stringify(s.value)}`;
    case "text":
      return `text: ${JSON.stringify(s.value)}`;
    case "contentDesc":
      return `desc ${JSON.stringify(s.value)}`;
    case "point":
      return `point: "${s.x_pct}%, ${s.y_pct}%"`;
  }
}

export function formatInspectResult(node: UINode, selectors: Selector[]): string {
  const b = node.bounds;
  const parts: string[] = [shortClass(node.class_name)];
  if (node.text?.trim()) parts.push(`text ${JSON.stringify(node.text.trim())}`);
  if (node.content_desc?.trim()) parts.push(`desc ${JSON.stringify(node.content_desc.trim())}`);
  if (node.resource_id) parts.push(`id ${JSON.stringify(node.resource_id)}`);
  parts.push(`bounds [${b.left},${b.top},${b.right - b.left},${b.bottom - b.top}]`);
  if (node.clickable) parts.push("clickable");
  if (!node.enabled) parts.push("disabled");

  const lines = [`element: ${parts.join(" ")}`];
  if (selectors.length === 0) {
    lines.push("selectors: none suggested");
  } else {
    lines.push("selectors (best first):");
    selectors.forEach((s, i) => lines.push(`${i + 1}. ${renderSelector(s)}`));
  }
  return lines.join("\n");
}

export const tools = [
  {
    spec: {
      name: "inspect_element",
      description:
        "Inspect the UI element at device-pixel coordinates (same referential as get_screen bounds) and get its ranked Maestro selectors. Call get_screen first so the screen is indexed. Use this to confirm the selector BEFORE writing a tapOn into a flow — never guess selector text.",
      inputSchema: {
        type: "object",
        properties: { x: { type: "number" }, y: { type: "number" } },
        required: ["x", "y"],
      },
    } satisfies ToolSpec,
    execute: async (input: { x: number; y: number }): Promise<string> => {
      requireDevice();
      const node = await ipc.queryElement(Math.round(input.x), Math.round(input.y));
      if (!node) return `no element at (${input.x}, ${input.y})`;
      const selectors = await ipc.suggestSelectors(node);
      return formatInspectResult(node, selectors);
    },
  },
];
