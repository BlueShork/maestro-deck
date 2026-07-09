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
vi.mock("@/lib/ipc", () => ({
  ipc: {
    environmentStatus: (...a: unknown[]) => mockStatus(...a),
    installTool: (...a: unknown[]) => mockInstall(...a),
  },
}));

import { useEnvStore, selectPopupVisible } from "./envStore";

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
