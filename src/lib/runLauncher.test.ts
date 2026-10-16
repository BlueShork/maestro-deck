import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writeTextFile: vi.fn(),
  runFlow: vi.fn(),
  stopFlow: vi.fn(),
  startCloudRun: vi.fn(),
  stopWatchingCloudRun: vi.fn(),
}));

vi.mock("@tauri-apps/api/path", () => ({
  tempDir: async () => "/tmp/",
  join: async (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: h.writeTextFile, readTextFile: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: vi.fn(), save: vi.fn(), open: vi.fn() }));
vi.mock("@/lib/ipc", () => ({ ipc: { runFlow: h.runFlow, stopFlow: h.stopFlow } }));
vi.mock("@/lib/cloudRunner", () => ({
  startCloudRun: h.startCloudRun,
  stopWatchingCloudRun: h.stopWatchingCloudRun,
}));

import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useFlowStore } from "@/stores/flowStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { runAllFlows, runFromLine, runOpenFlow, stopRun } from "./runLauncher";

const FLOW = "appId: com.app\nname: Login\n---\n- launchApp\n- tapOn: Login\n- back\n";
const toastError = vi.spyOn(toast, "error");
const logTexts = () => useRunStore.getState().logs.map((l) => l.text);

beforeEach(() => {
  h.files.clear();
  h.writeTextFile.mockReset().mockImplementation(async (p: string, c: string) => {
    h.files.set(p, c);
  });
  h.runFlow.mockReset().mockResolvedValue(777);
  h.stopFlow.mockReset().mockResolvedValue(undefined);
  h.startCloudRun.mockReset().mockResolvedValue(undefined);
  h.stopWatchingCloudRun.mockReset();
  toastError.mockClear();
  useRunStore.setState({
    running: false,
    starting: false,
    pid: null,
    cloud: null,
    stopRequested: false,
    logs: [],
    steps: [],
    runTarget: null,
  });
  useFlowStore.setState({ content: FLOW, filePath: "/ws/login.yaml", dirty: true });
  useWorkspaceStore.setState({ folderPath: "/ws" });
  useSettingsStore.setState({ appId: "com.app" });
  useCloudTargetStore.setState({ target: null });
});

describe("runOpenFlow", () => {
  it("saves the open file, arms its steps and starts the runner on it", async () => {
    await runOpenFlow();
    expect(h.files.get("/ws/login.yaml")).toBe(FLOW);
    expect(useFlowStore.getState().dirty).toBe(false);
    expect(h.runFlow).toHaveBeenCalledWith("/ws/login.yaml", "com.app", "/ws");
    const s = useRunStore.getState();
    expect(s).toMatchObject({
      running: true,
      starting: false,
      pid: 777,
      runTarget: { path: "/ws/login.yaml", kind: "flow" },
    });
    expect(s.steps.map((x) => x.command)).toEqual(["launchApp", "tapOn", "back"]);
    expect(logTexts()).toEqual(["[runner started pid 777 · /ws/login.yaml]"]);
  });

  it("runs an untitled buffer from a temp copy without touching the editor state", async () => {
    useFlowStore.setState({ filePath: null, dirty: true });
    await runOpenFlow();
    expect(h.files.get("/tmp/maestro-deck-flow.yaml")).toBe(FLOW);
    expect(h.runFlow.mock.calls[0][0]).toBe("/tmp/maestro-deck-flow.yaml");
    expect(useFlowStore.getState()).toMatchObject({ filePath: null, dirty: true });
  });

  it("sends the run to the cloud when a cloud target is chosen", async () => {
    useCloudTargetStore.setState({ target: "android" });
    await runOpenFlow();
    expect(h.startCloudRun).toHaveBeenCalledWith("android", ["/ws/login.yaml"]);
    expect(h.runFlow).not.toHaveBeenCalled();
  });

  it("ignores a second Run while one is starting or running", async () => {
    useRunStore.setState({ starting: true });
    await runOpenFlow();
    useRunStore.setState({ starting: false, running: true });
    await runOpenFlow();
    expect(h.runFlow).not.toHaveBeenCalled();
    expect(h.writeTextFile).not.toHaveBeenCalled();
  });

  it("a failed start resets the toolbar and reports", async () => {
    h.runFlow.mockRejectedValue(new Error("maestro not found"));
    await runOpenFlow();
    expect(useRunStore.getState()).toMatchObject({ starting: false, running: false });
    expect(toastError).toHaveBeenCalledWith("Run failed", "maestro not found");
  });

  it("a save failure aborts the run before spawning", async () => {
    h.writeTextFile.mockRejectedValue(new Error("read-only"));
    await runOpenFlow();
    expect(h.runFlow).not.toHaveBeenCalled();
    expect(useRunStore.getState().starting).toBe(false);
    expect(toastError).toHaveBeenCalledWith("Run failed", "read-only");
  });
});

describe("runAllFlows", () => {
  it("saves pending edits and runs the folder, gated on the open flow's name", async () => {
    await runAllFlows();
    expect(h.files.get("/ws/login.yaml")).toBe(FLOW);
    expect(h.runFlow).toHaveBeenCalledWith("/ws", "com.app", "/ws");
    expect(useRunStore.getState()).toMatchObject({
      runTarget: { path: "/ws", kind: "all" },
      expectedFlow: "Login",
      flowGateOpen: false,
      pid: 777,
    });
    expect(logTexts()).toEqual(["[runner started pid 777 · all flows in /ws]"]);
  });

  it("does not rewrite a clean file", async () => {
    useFlowStore.setState({ dirty: false });
    await runAllFlows();
    expect(h.writeTextFile).not.toHaveBeenCalled();
    expect(h.runFlow).toHaveBeenCalledOnce();
  });

  it("needs a workspace folder", async () => {
    useWorkspaceStore.setState({ folderPath: null });
    await runAllFlows();
    expect(h.runFlow).not.toHaveBeenCalled();
    expect(useRunStore.getState().starting).toBe(false);
  });

  it("a failed start resets and reports", async () => {
    h.runFlow.mockRejectedValue("spawn failed");
    await runAllFlows();
    expect(useRunStore.getState().starting).toBe(false);
    expect(toastError).toHaveBeenCalledWith("Run all failed", "spawn failed");
  });
});

describe("runFromLine", () => {
  it("runs the header plus the steps from that line, highlighting original lines", async () => {
    await runFromLine(5);
    const written = h.files.get("/tmp/maestro-deck-flow.yaml")!;
    expect(written).toContain("appId: com.app");
    expect(written).not.toContain("launchApp");
    expect(written).toContain("- tapOn: Login");
    expect(useRunStore.getState().steps.map((s) => s.line)).toEqual([5, 6]);
    expect(useFlowStore.getState()).toMatchObject({ dirty: true });
    expect(logTexts()).toEqual(["[runner started pid 777 · from line 5]"]);
  });

  it("does nothing past the last step", async () => {
    await runFromLine(99);
    expect(h.runFlow).not.toHaveBeenCalled();
    expect(useRunStore.getState().starting).toBe(false);
  });

  it("a failed start resets and reports", async () => {
    h.runFlow.mockRejectedValue(new Error("boom"));
    await runFromLine(4);
    expect(useRunStore.getState().starting).toBe(false);
    expect(toastError).toHaveBeenCalledWith("Run from here failed", "boom");
  });
});

describe("stopRun", () => {
  it("asks the backend to stop the local runner and flags the stop", async () => {
    useRunStore.setState({ running: true, pid: 777 });
    await stopRun();
    expect(h.stopFlow).toHaveBeenCalledWith(777);
    expect(useRunStore.getState().stopRequested).toBe(true);
  });

  it("only stops watching a cloud run", async () => {
    useRunStore.setState({ running: true, cloud: { jobId: "j", status: "running" } });
    await stopRun();
    expect(h.stopWatchingCloudRun).toHaveBeenCalledOnce();
    expect(h.stopFlow).not.toHaveBeenCalled();
  });

  it("does nothing without a runner", async () => {
    await stopRun();
    expect(h.stopFlow).not.toHaveBeenCalled();
    expect(useRunStore.getState().stopRequested).toBe(false);
  });

  it("reports a stop failure", async () => {
    useRunStore.setState({ running: true, pid: 777 });
    h.stopFlow.mockRejectedValue(new Error("no runner with PID 777"));
    await stopRun();
    expect(toastError).toHaveBeenCalledWith("Stop failed", "no runner with PID 777");
  });
});
