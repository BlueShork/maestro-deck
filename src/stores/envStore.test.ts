// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

const mockStatus = vi.fn();
const mockInstall = vi.fn();
const mockSetupTools = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: {
    environmentStatus: (...a: unknown[]) => mockStatus(...a),
    installTool: (...a: unknown[]) => mockInstall(...a),
    setupTools: (...a: unknown[]) => mockSetupTools(...a),
  },
}));

import { useEnvStore, selectPopupVisible, selectSetupChip } from "./envStore";

const okCheck = (id: string) => ({ id, status: "ok", version: null, detail: null });
const missing = (id: string) => ({ id, status: "missing", version: null, detail: null });

describe("envStore", () => {
  beforeEach(() => {
    useEnvStore.setState({
      checks: [],
      minimalOk: null,
      checking: false,
      installingId: null,
      lastInstallLine: null,
      installError: null,
      collapsed: false,
      dismissedForever: false,
    });
    mockStatus.mockReset();
    mockInstall.mockReset();
  });

  it("popup is hidden before the first check resolves (no flash)", () => {
    expect(selectPopupVisible(useEnvStore.getState())).toBe(false);
  });

  it("refresh stores checks and minimalOk; popup shows when minimal is not met", async () => {
    mockStatus.mockResolvedValue({
      checks: [missing("maestro"), okCheck("java"), okCheck("adb"), okCheck("xcode")],
      minimalOk: false,
    });
    await useEnvStore.getState().refresh();
    const s = useEnvStore.getState();
    expect(s.minimalOk).toBe(false);
    expect(s.checks).toHaveLength(4);
    expect(selectPopupVisible(s)).toBe(true);
  });

  it("warnings alone (adb/xcode missing) don't show the popup", async () => {
    mockStatus.mockResolvedValue({
      checks: [okCheck("maestro"), okCheck("java"), missing("adb"), missing("xcode")],
      minimalOk: true,
    });
    await useEnvStore.getState().refresh();
    expect(selectPopupVisible(useEnvStore.getState())).toBe(false);
  });

  it("install tracks installingId and clears it on success, then re-checks", async () => {
    mockInstall.mockResolvedValue(undefined);
    mockStatus.mockResolvedValue({
      checks: [okCheck("maestro"), okCheck("java"), okCheck("adb"), okCheck("xcode")],
      minimalOk: true,
    });
    const p = useEnvStore.getState().install("maestro");
    expect(useEnvStore.getState().installingId).toBe("maestro");
    await p;
    const s = useEnvStore.getState();
    expect(s.installingId).toBeNull();
    expect(s.installError).toBeNull();
    expect(mockStatus).toHaveBeenCalled(); // auto re-check after install
  });

  it("failed install surfaces installError and keeps the popup", async () => {
    mockInstall.mockRejectedValue(new Error("install exited with code 1"));
    mockStatus.mockResolvedValue({ checks: [missing("maestro")], minimalOk: false });
    await useEnvStore.getState().install("maestro");
    const s = useEnvStore.getState();
    expect(s.installingId).toBeNull();
    expect(s.installError).toContain("exited with code 1");
  });

  it("dismiss only sticks after minimalOk was observed", async () => {
    mockStatus.mockResolvedValue({ checks: [], minimalOk: true });
    await useEnvStore.getState().refresh();
    useEnvStore.getState().dismiss();
    expect(useEnvStore.getState().dismissedForever).toBe(true);
    expect(selectPopupVisible(useEnvStore.getState())).toBe(false);
  });

  it("dismiss is a no-op while the minimum is not met", async () => {
    mockStatus.mockResolvedValue({ checks: [missing("maestro")], minimalOk: false });
    await useEnvStore.getState().refresh();
    useEnvStore.getState().dismiss();
    expect(useEnvStore.getState().dismissedForever).toBe(false);
  });

  it("onInstallOutput keeps the last line for the progress row", () => {
    useEnvStore.setState({ installingId: "maestro" });
    useEnvStore.getState().onInstallOutput("maestro", "Downloading 2.5.1…");
    expect(useEnvStore.getState().lastInstallLine).toBe("Downloading 2.5.1…");
    // Lines for another tool id are ignored.
    useEnvStore.getState().onInstallOutput("java", "nope");
    expect(useEnvStore.getState().lastInstallLine).toBe("Downloading 2.5.1…");
  });
});

describe("automatic first-launch setup", () => {
  beforeEach(() => {
    useEnvStore.setState({
      minimalOk: null,
      setupRunning: false,
      setupTool: null,
      setupPercent: null,
      setupFailures: [],
    });
  });

  it("reports the tool and its progress while installing", () => {
    useEnvStore.getState().onSetupProgress({
      tool: "java",
      label: "Java",
      phase: "download",
      percent: 62,
    });

    const s = useEnvStore.getState();
    expect(s.setupTool).toBe("Java");
    expect(s.setupPercent).toBe(62);
  });

  it("drops the percentage while extracting rather than freezing it at 100", () => {
    useEnvStore.getState().onSetupProgress({
      tool: "java",
      label: "Java",
      phase: "extract",
      percent: null,
    });
    expect(useEnvStore.getState().setupPercent).toBeNull();
  });

  it("records a failed tool without stopping the others", () => {
    useEnvStore
      .getState()
      .onSetupDone({ tool: "java", label: "Java", ok: false, error: "network unreachable" });
    useEnvStore
      .getState()
      .onSetupDone({ tool: "adb", label: "Android platform tools", ok: true, error: null });

    const failures = useEnvStore.getState().setupFailures;
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ label: "Java", error: "network unreachable" });
  });

  it("clears an earlier failure when the tool succeeds on retry", () => {
    useEnvStore.getState().onSetupDone({ tool: "java", label: "Java", ok: false, error: "boom" });
    useEnvStore.getState().onSetupDone({ tool: "java", label: "Java", ok: true, error: null });
    expect(useEnvStore.getState().setupFailures).toHaveLength(0);
  });
});

describe("runSetup", () => {
  beforeEach(() => {
    useEnvStore.setState({
      minimalOk: null,
      setupRunning: false,
      setupTool: null,
      setupPercent: null,
      setupFailures: [],
    });
    mockStatus.mockReset();
    mockSetupTools.mockReset();
    mockStatus.mockResolvedValue({
      checks: [okCheck("maestro"), okCheck("java")],
      minimalOk: true,
    });
  });

  it("re-probes the environment once the install finished", async () => {
    mockSetupTools.mockResolvedValue(undefined);

    await useEnvStore.getState().runSetup();

    expect(mockStatus).toHaveBeenCalledTimes(1);
    expect(useEnvStore.getState().minimalOk).toBe(true);
  });

  it("does not start a second install while one is running", async () => {
    let finish!: () => void;
    mockSetupTools.mockReturnValue(new Promise<void>((r) => (finish = r)));

    const first = useEnvStore.getState().runSetup();
    await useEnvStore.getState().runSetup();
    finish();
    await first;

    expect(mockSetupTools).toHaveBeenCalledTimes(1);
  });

  it("clears the progress chip when done, even if the command itself failed", async () => {
    mockSetupTools.mockImplementation(async () => {
      useEnvStore
        .getState()
        .onSetupProgress({ tool: "java", label: "Java", phase: "download", percent: 40 });
      throw new Error("command not found");
    });

    await useEnvStore.getState().runSetup();

    expect(useEnvStore.getState()).toMatchObject({
      setupRunning: false,
      setupTool: null,
      setupPercent: null,
    });
    expect(mockStatus).toHaveBeenCalled();
  });

  it("forgets the failures of a previous attempt when retrying", async () => {
    useEnvStore.setState({ setupFailures: [{ tool: "java", label: "Java", error: "timeout" }] });
    mockSetupTools.mockResolvedValue(undefined);

    await useEnvStore.getState().runSetup();

    expect(useEnvStore.getState().setupFailures).toEqual([]);
  });
});

describe("selectSetupChip", () => {
  it("says nothing once everything is in place", () => {
    useEnvStore.setState({ minimalOk: true, setupRunning: false, setupFailures: [] });
    expect(selectSetupChip(useEnvStore.getState())).toBeNull();
  });

  it("names what is installing, so a disabled Run is never a mystery", () => {
    useEnvStore.setState({
      minimalOk: false,
      setupRunning: true,
      setupTool: "Java",
      setupPercent: 62,
      setupFailures: [],
    });
    expect(selectSetupChip(useEnvStore.getState())).toEqual({
      state: "installing",
      text: "Setting up — Java 62%",
    });
  });

  it("names the tool that failed", () => {
    useEnvStore.setState({
      minimalOk: false,
      setupRunning: false,
      setupFailures: [{ tool: "java", label: "Java", error: "network unreachable" }],
    });
    expect(selectSetupChip(useEnvStore.getState())).toEqual({
      state: "failed",
      text: "Setup failed — Java",
    });
  });
});
