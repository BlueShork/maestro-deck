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

import { useSettingsStore } from "./settingsStore";

const INITIAL = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState({
    inspectKey: "i",
    showFps: INITIAL.showFps,
    theme: "system",
    streamEnabled: true,
    perfMonitoringEnabled: false,
    fastHierarchyEnabled: false,
    autoSaveEnabled: true,
    consoleMode: "simple",
    appId: "",
  });
});

describe("settingsStore defaults", () => {
  it("uses sensible defaults", () => {
    const s = useSettingsStore.getState();
    expect(s.inspectKey).toBe("i");
    expect(s.theme).toBe("system");
    expect(s.streamEnabled).toBe(true);
    expect(s.perfMonitoringEnabled).toBe(false);
    expect(s.fastHierarchyEnabled).toBe(false);
    expect(s.autoSaveEnabled).toBe(true);
    expect(s.consoleMode).toBe("simple");
    // Web support is beta — the target stays hidden until opted in.
    expect(s.webBrowserEnabled).toBe(false);
    expect(s.appId).toBe("");
  });
});

describe("settingsStore setters", () => {
  it("setInspectKey updates the value", () => {
    useSettingsStore.getState().setInspectKey("k");
    expect(useSettingsStore.getState().inspectKey).toBe("k");
  });

  it("setShowFps updates the value", () => {
    useSettingsStore.getState().setShowFps(true);
    expect(useSettingsStore.getState().showFps).toBe(true);
    useSettingsStore.getState().setShowFps(false);
    expect(useSettingsStore.getState().showFps).toBe(false);
  });

  it("setTheme accepts each valid mode", () => {
    const set = useSettingsStore.getState().setTheme;
    for (const m of ["light", "dark", "system"] as const) {
      set(m);
      expect(useSettingsStore.getState().theme).toBe(m);
    }
  });

  it("setStreamEnabled / setPerfMonitoringEnabled / setFastHierarchyEnabled / setAutoSaveEnabled toggle their flags", () => {
    const s = useSettingsStore.getState();
    s.setStreamEnabled(false);
    s.setPerfMonitoringEnabled(true);
    s.setFastHierarchyEnabled(true);
    s.setAutoSaveEnabled(false);
    const after = useSettingsStore.getState();
    expect(after.streamEnabled).toBe(false);
    expect(after.perfMonitoringEnabled).toBe(true);
    expect(after.fastHierarchyEnabled).toBe(true);
    expect(after.autoSaveEnabled).toBe(false);
  });

  it("setWebBrowserEnabled toggles the flag", () => {
    useSettingsStore.getState().setWebBrowserEnabled(true);
    expect(useSettingsStore.getState().webBrowserEnabled).toBe(true);
    useSettingsStore.getState().setWebBrowserEnabled(false);
    expect(useSettingsStore.getState().webBrowserEnabled).toBe(false);
  });

  it("setConsoleMode accepts simple and technical", () => {
    useSettingsStore.getState().setConsoleMode("technical");
    expect(useSettingsStore.getState().consoleMode).toBe("technical");
    useSettingsStore.getState().setConsoleMode("simple");
    expect(useSettingsStore.getState().consoleMode).toBe("simple");
  });

  it("setAppId stores a trimmed value", () => {
    useSettingsStore.getState().setAppId("  com.example.app  ");
    expect(useSettingsStore.getState().appId).toBe("com.example.app");
    useSettingsStore.getState().setAppId("");
    expect(useSettingsStore.getState().appId).toBe("");
  });
});
