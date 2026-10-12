import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const h = vi.hoisted(() => ({
  compareScreenshots: vi.fn(),
  compareScreenshotsAll: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: { compareScreenshots: h.compareScreenshots, compareScreenshotsAll: h.compareScreenshotsAll },
}));
vi.mock("@/lib/telemetry", () => ({ track: h.track }));
vi.mock("@/lib/cloudAuth", () => ({
  fetchCloudBilling: vi.fn(),
  onCloudAuthStateChanged: vi.fn(),
}));

import type { RunReport } from "@/types/visualRegression";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudInviteStore } from "@/stores/cloudInviteStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useReviewStore } from "@/stores/reviewStore";
import { useRunStore } from "@/stores/runStore";
import { toast } from "@/stores/toastStore";
import { useVisualRegressionStore } from "@/stores/visualRegressionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { CLOUD_INVITE_DELAY_MS, handleRunnerExit } from "./runExit";

const PIXEL = {
  serial: "emulator-5554",
  platform: "android",
  model: "Pixel 7",
  booted: true,
  physical: false,
  screen_width: 1080,
  screen_height: 2400,
};

const report = (statuses: string[]): RunReport => ({
  run_id: "r",
  device_key: "pixel",
  comparisons: statuses.map((status, i) => ({
    name: `shot${i}`,
    status: status as never,
    changed_ratio: 0,
    bbox: null,
  })),
});

const spies = {
  success: vi.spyOn(toast, "success"),
  error: vi.spyOn(toast, "error"),
  info: vi.spyOn(toast, "info"),
  loading: vi.spyOn(toast, "loading"),
  dismiss: vi.spyOn(toast, "dismiss"),
};
const logTexts = () => useRunStore.getState().logs.map((l) => l.text);
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.values(spies).forEach((s) => s.mockClear());
  h.track.mockClear();
  h.compareScreenshots.mockReset();
  h.compareScreenshotsAll.mockReset();
  useRunStore.setState({
    running: true,
    pid: 4242,
    stopRequested: false,
    exitCode: null,
    logs: [],
    runTarget: { path: "/ws/login.yaml", kind: "flow" },
  });
  useDeviceStore.setState({ current: PIXEL as never });
  useWorkspaceStore.setState({ folderPath: "/ws" });
  useCloudAuthStore.setState({ user: null });
  useCloudInviteStore.setState({ asked: false, open: false });
  useVisualRegressionStore.setState({ enabled: false, ignoreStatusBar: false });
  useReviewStore.setState({ report: null });
});
afterEach(() => vi.useRealTimers());

describe("handleRunnerExit — outcome", () => {
  it("a passing run: log line, stopped state, success toast, telemetry", () => {
    handleRunnerExit(0);
    expect(logTexts()).toEqual(["[runner exited with code 0]"]);
    expect(useRunStore.getState()).toMatchObject({ running: false, pid: null, exitCode: 0 });
    expect(spies.success).toHaveBeenCalledWith("Flow completed");
    expect(h.track).toHaveBeenCalledWith("flow_run_finished", {
      platform: "android",
      physical: false,
      scope: "flow",
      outcome: "passed",
    });
  });

  it("a failing run reports its exit code", () => {
    handleRunnerExit(1);
    expect(spies.error).toHaveBeenCalledWith("Flow failed", "exit code 1");
    expect(h.track.mock.calls[0][1].outcome).toBe("failed");
  });

  it("a run the user stopped says so, whatever the exit code", () => {
    useRunStore.setState({ stopRequested: true });
    handleRunnerExit(143);
    expect(logTexts()).toEqual(["[runner stopped by user]"]);
    expect(spies.success).toHaveBeenCalledWith("Flow stopped");
    expect(spies.error).not.toHaveBeenCalled();
    expect(h.track.mock.calls[0][1].outcome).toBe("stopped");
  });

  it("flushes queued runner output before the exit line", () => {
    useRunStore.getState().queueLog("stdout", "Assertion is false");
    handleRunnerExit(1);
    expect(logTexts()).toEqual(["Assertion is false", "[runner exited with code 1]"]);
  });
});

describe("handleRunnerExit — cloud offer", () => {
  it("offers the cloud after a first passing run, once the toast had time to land", async () => {
    handleRunnerExit(0);
    expect(useCloudInviteStore.getState().open).toBe(false);
    await vi.advanceTimersByTimeAsync(CLOUD_INVITE_DELAY_MS);
    expect(useCloudInviteStore.getState().open).toBe(true);
  });

  it("does not offer it to a signed-in user, even one who signs in meanwhile", async () => {
    useCloudAuthStore.setState({ user: { uid: "u" } as never });
    handleRunnerExit(0);
    await vi.advanceTimersByTimeAsync(CLOUD_INVITE_DELAY_MS);
    expect(useCloudInviteStore.getState().open).toBe(false);

    useCloudAuthStore.setState({ user: null });
    handleRunnerExit(0);
    useCloudAuthStore.setState({ user: { uid: "u" } as never });
    await vi.advanceTimersByTimeAsync(CLOUD_INVITE_DELAY_MS);
    expect(useCloudInviteStore.getState().open).toBe(false);
  });

  it("does not offer it after a failed or stopped run", async () => {
    handleRunnerExit(1);
    useRunStore.setState({ stopRequested: true });
    handleRunnerExit(0);
    await vi.advanceTimersByTimeAsync(CLOUD_INVITE_DELAY_MS);
    expect(useCloudInviteStore.getState().asked).toBe(false);
  });
});

describe("handleRunnerExit — screenshot bank", () => {
  beforeEach(() =>
    useVisualRegressionStore.setState({ enabled: true, tolerance: null, threshold: null }),
  );

  it("compares the flow's captures against the bank for this device", async () => {
    h.compareScreenshots.mockResolvedValue(report(["match", "changed"]));
    handleRunnerExit(0);
    expect(h.compareScreenshots).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace: "/ws",
        flowPath: "/ws/login.yaml",
        model: "Pixel 7",
        width: 1080,
        height: 2400,
        runId: "4242",
        platform: "android",
        ignoreStatusBar: false,
      }),
    );
    await settle();
    expect(useReviewStore.getState().report?.comparisons).toHaveLength(2);
    expect(spies.dismiss).toHaveBeenCalledWith(spies.loading.mock.results[0].value);
    expect(logTexts()).toContain("[bank] 1 match · 1 changed · 0 new · 0 missing");
  });

  it("compares the whole folder after Run All", async () => {
    useRunStore.setState({ runTarget: { path: "/ws", kind: "all" } });
    h.compareScreenshotsAll.mockResolvedValue(report(["match"]));
    handleRunnerExit(0);
    expect(h.compareScreenshotsAll).toHaveBeenCalledOnce();
    expect(h.compareScreenshotsAll.mock.calls[0][0]).not.toHaveProperty("flowPath");
    await settle();
  });

  it("reports a failed comparison in a toast and the console", async () => {
    h.compareScreenshots.mockRejectedValue("bank dir unreadable");
    handleRunnerExit(0);
    await settle();
    expect(spies.error).toHaveBeenCalledWith("Screenshot bank check failed", "bank dir unreadable");
    expect(logTexts()).toContain("[bank] comparison failed: bank dir unreadable");
    expect(spies.dismiss).toHaveBeenCalled();
  });

  it("skips the check when it can't be attributed: failed run, no workspace, no device, disabled", () => {
    handleRunnerExit(1);
    useWorkspaceStore.setState({ folderPath: null });
    handleRunnerExit(0);
    useWorkspaceStore.setState({ folderPath: "/ws" });
    useDeviceStore.setState({ current: null });
    handleRunnerExit(0);
    useDeviceStore.setState({ current: PIXEL as never });
    useVisualRegressionStore.setState({ enabled: false });
    handleRunnerExit(0);
    expect(h.compareScreenshots).not.toHaveBeenCalled();
    expect(spies.loading).not.toHaveBeenCalled();
  });
});
