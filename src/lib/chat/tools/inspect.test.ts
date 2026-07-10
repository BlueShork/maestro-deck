// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it, vi } from "vitest";

import type { Selector, UINode } from "@/types";

// Mock ipc before importing the module under test
vi.mock("@/lib/ipc", () => ({
  ipc: {
    queryElement: vi.fn(),
    suggestSelectors: vi.fn(),
  },
}));

const { formatInspectResult, tools } = await import("./inspect");

// Fixture node matching the brief spec
const baseNode: UINode = {
  id: "node-1",
  resource_id: "login_submit",
  text: "Sign in",
  content_desc: null,
  class_name: "android.widget.Button",
  package: "com.example",
  bounds: { left: 40, top: 820, right: 380, bottom: 884 },
  clickable: true,
  enabled: true,
  focused: false,
  children: [],
};

const baseSelectors: Selector[] = [
  { kind: "resourceId", value: "login_submit" },
  { kind: "text", value: "Sign in" },
];

describe("formatInspectResult", () => {
  it("formats the primary fixture exactly", () => {
    const result = formatInspectResult(baseNode, baseSelectors);
    const expected = [
      'element: Button text "Sign in" id "login_submit" bounds [40,820,340,64] clickable',
      "selectors (best first):",
      '1. id: "login_submit"',
      '2. text: "Sign in"',
    ].join("\n");
    expect(result).toBe(expected);
  });

  it('renders contentDesc selector as `desc "<value>"`', () => {
    const selectors: Selector[] = [{ kind: "contentDesc", value: "Close" }];
    const result = formatInspectResult(baseNode, selectors);
    expect(result).toContain('1. desc "Close"');
  });

  it('renders point selector as `point: "<x>%, <y>%"`', () => {
    const selectors: Selector[] = [{ kind: "point", x_pct: 50, y_pct: 70 }];
    const result = formatInspectResult(baseNode, selectors);
    expect(result).toContain('1. point: "50%, 70%"');
  });

  it("renders `selectors: none suggested` when selectors array is empty", () => {
    const result = formatInspectResult(baseNode, []);
    expect(result).toContain("selectors: none suggested");
    expect(result).not.toContain("selectors (best first):");
  });
});

describe("inspect_element tool — no device", () => {
  it("throws No device error when no device is connected", async () => {
    const { useDeviceStore } = await import("@/stores/deviceStore");
    const prev = useDeviceStore.getState().current;
    useDeviceStore.setState({ current: null });
    try {
      const tool = tools[0];
      await expect(tool.execute({ x: 100, y: 200 })).rejects.toThrow(/No device/i);
    } finally {
      useDeviceStore.setState({ current: prev });
    }
  });
});
