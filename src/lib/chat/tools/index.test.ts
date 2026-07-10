// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRunStore } from "@/stores/runStore";
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
    stopFlow: vi.fn(),
    launchAppOnDevice: vi.fn(),
    stopAppOnDevice: vi.fn(),
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
  "launch_app",
  "stop_app",
];

describe("Tool registry", () => {
  // Test 1: ALL_TOOLS contains exactly the 11 expected tools
  it("ALL_TOOLS contains exactly the 11 expected tool names, no duplicates", () => {
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

  // Test 5: executeTool("launch_app", {}) with no device → isError true, message mentions "No device"
  it('executeTool("launch_app", {}) with no device → isError true mentioning "No device"', async () => {
    const { useDeviceStore } = await import("@/stores/deviceStore");
    const prev = useDeviceStore.getState().current;
    useDeviceStore.setState({ current: null });
    try {
      const result = await executeTool("launch_app", {});
      expect(result.isError).toBe(true);
      expect(result.content).toMatch(/No device/i);
    } finally {
      useDeviceStore.setState({ current: prev });
    }
  });

  // Test 7: run_flow aborts cleanly when signal fires mid-run
  describe("run_flow abort handling", () => {
    let prevRunState: ReturnType<typeof useRunStore.getState>;

    beforeEach(async () => {
      prevRunState = useRunStore.getState();
    });

    afterEach(() => {
      // Restore run store to pre-test state
      useRunStore.setState({
        running: prevRunState.running,
        starting: prevRunState.starting,
        pid: prevRunState.pid,
        exitCode: prevRunState.exitCode,
        stopRequested: prevRunState.stopRequested,
        logs: prevRunState.logs,
        steps: prevRunState.steps,
        runTarget: prevRunState.runTarget,
      });
    });

    it("calls stopFlow and resolves with stoppedByUser:true when signal aborts mid-run", async () => {
      const { ipc } = await import("@/lib/ipc");
      const stopFlowMock = vi.mocked(ipc.stopFlow);
      stopFlowMock.mockResolvedValue(undefined as never);

      const readMock = vi.mocked(ipc.readWorkspaceFile);
      readMock.mockResolvedValue("appId: com.example\n---\n- launchApp:\n    appId: com.example");

      const runFlowMock = vi.mocked(ipc.runFlow);
      runFlowMock.mockResolvedValue(123);

      // Set workspace so the tool doesn't throw
      const prevWs = useWorkspaceStore.getState().folderPath;
      useWorkspaceStore.setState({ folderPath: "/ws" });

      const ac = new AbortController();

      // Start the tool; after setRunning fires, abort the signal, then simulate runner exit
      const toolPromise = executeTool("run_flow", { path: "test.yaml" }, ac.signal);

      // Wait until the store shows running with pid 123, then abort and simulate stop
      await new Promise<void>((resolve) => {
        const unsub = useRunStore.subscribe((s) => {
          if (s.running && s.pid === 123) {
            unsub();
            resolve();
          }
        });
        // Check immediately in case already set
        if (useRunStore.getState().running && useRunStore.getState().pid === 123) {
          unsub();
          resolve();
        }
      });

      // Abort the signal — triggers stopFlow + bounded wait
      ac.abort();

      // Give the abort handler a tick to register, then simulate the runner stopping
      await Promise.resolve();
      useRunStore.getState().setStopped(1);

      const result = await toolPromise;
      expect(result.isError).toBe(false);
      const parsed = JSON.parse(result.content as string) as {
        exitCode: number | null;
        stoppedByUser: boolean;
        tail: string;
      };
      expect(parsed.stoppedByUser).toBe(true);
      expect(stopFlowMock).toHaveBeenCalledWith(123);

      useWorkspaceStore.setState({ folderPath: prevWs });
    });
  });

  // Test 8: executeTool("list_flows") with stubbed workspace returns sorted relative paths
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
