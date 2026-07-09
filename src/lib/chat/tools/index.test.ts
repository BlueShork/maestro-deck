// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types";

// Mock heavy modules so the test can import the tool registry without Tauri
vi.mock("@/lib/ipc", () => ({
  ipc: {
    enterInspectMode: vi.fn(),
    sendInput: vi.fn(),
    iosPressHome: vi.fn(),
    readWorkspaceFile: vi.fn(),
    writeWorkspaceFile: vi.fn(),
    listWorkspace: vi.fn(),
    runFlow: vi.fn(),
  },
}));

vi.mock("@/lib/deviceFrame", () => ({
  captureDeviceFrame: vi.fn(),
  registerDeviceCanvas: vi.fn(),
}));

vi.mock("@/lib/flow-io", () => ({
  openFlowFile: vi.fn(),
}));

vi.mock("@/lib/flowAst", () => ({
  parseFlow: vi.fn(() => ({ steps: [] })),
}));

// Import after mocks
const { ALL_TOOLS, executeTool } = await import("./index");

const EXPECTED_TOOL_NAMES = [
  "get_screen",
  "take_screenshot",
  "tap",
  "input_text",
  "press_key",
  "list_flows",
  "read_flow",
  "write_flow",
  "run_flow",
];

describe("Tool registry", () => {
  // Test 1: ALL_TOOLS contains exactly the 9 expected tools
  it("ALL_TOOLS contains exactly the 9 expected tool names, no duplicates", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(names).toHaveLength(EXPECTED_TOOL_NAMES.length);
    expect(new Set(names).size).toBe(names.length); // no duplicates
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(names).toContain(name);
    }
  });

  // Test 2: every spec has inputSchema.type === "object" and required only lists declared properties
  it("every spec inputSchema has type=object and required only lists declared properties", () => {
    for (const spec of ALL_TOOLS) {
      const schema = spec.inputSchema as {
        type: string;
        properties?: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, `${spec.name} inputSchema.type`).toBe("object");
      const declared = Object.keys(schema.properties ?? {});
      const required = schema.required ?? [];
      for (const r of required) {
        expect(declared, `${spec.name} required field "${r}" must be declared`).toContain(r);
      }
    }
  });

  // Test 3: executeTool with unknown tool name → isError: true
  it('executeTool("nope", {}) returns isError:true', async () => {
    const result = await executeTool("nope", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Unknown tool");
  });

  // Test 4: executeTool("tap", ...) with no device → isError true, message mentions "No device"
  it('executeTool("tap", {x:1,y:2}) with no device → isError true mentioning "No device"', async () => {
    // Ensure device store has no current device
    const { useDeviceStore } = await import("@/stores/deviceStore");
    const prev = useDeviceStore.getState().current;
    useDeviceStore.setState({ current: null });
    try {
      const result = await executeTool("tap", { x: 1, y: 2 });
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/No device/i);
    } finally {
      useDeviceStore.setState({ current: prev });
    }
  });

  // Test 5: executeTool("list_flows") with stubbed workspace returns sorted relative paths
  describe("list_flows with stubbed workspace", () => {
    let prevFolderPath: string | null;
    let prevTree: WorkspaceNode | null;

    beforeEach(() => {
      const state = useWorkspaceStore.getState();
      prevFolderPath = state.folderPath;
      prevTree = state.tree;
    });

    afterEach(() => {
      useWorkspaceStore.setState({ folderPath: prevFolderPath, tree: prevTree });
    });

    it("returns sorted relative yaml paths", async () => {
      const ws = "/workspace";
      const tree: WorkspaceNode = {
        kind: "dir",
        name: "workspace",
        path: ws,
        children: [
          {
            kind: "file",
            name: "login.yaml",
            path: "/workspace/login.yaml",
          },
          {
            kind: "dir",
            name: "sub",
            path: "/workspace/sub",
            children: [
              {
                kind: "file",
                name: "steps.yaml",
                path: "/workspace/sub/steps.yaml",
              },
            ],
          },
          {
            kind: "file",
            name: "app.yaml",
            path: "/workspace/app.yaml",
          },
          {
            kind: "file",
            name: "readme.txt",
            path: "/workspace/readme.txt",
          },
        ],
      };

      useWorkspaceStore.setState({ folderPath: ws, tree });

      const result = await executeTool("list_flows", {});
      expect(result.isError).toBe(false);
      const lines = (result.content as string).split("\n");
      // Should contain the yaml files sorted, no readme.txt
      expect(lines).toContain("app.yaml");
      expect(lines).toContain("login.yaml");
      expect(lines).toContain("sub/steps.yaml");
      expect(lines).not.toContain("readme.txt");
      // Verify sorted order
      const sorted = [...lines].sort();
      expect(lines).toEqual(sorted);
    });
  });
});
