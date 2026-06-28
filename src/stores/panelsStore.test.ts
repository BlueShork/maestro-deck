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

import { usePanelsStore, migratePanelsStore } from "./panelsStore";

beforeEach(() => {
  usePanelsStore.getState().showAll();
});

describe("panelsStore", () => {
  it("defaults panels to visible except the metrics tab", () => {
    const { visible } = usePanelsStore.getState();
    expect(visible).toEqual({
      workspace: true,
      inspector: true,
      device: true,
      editor: true,
      console: true,
      // The Performance tab is closed by default — opening it starts capture.
      metrics: false,
    });
  });

  it("toggle flips a single panel", () => {
    usePanelsStore.getState().toggle("inspector");
    expect(usePanelsStore.getState().visible.inspector).toBe(false);
    usePanelsStore.getState().toggle("inspector");
    expect(usePanelsStore.getState().visible.inspector).toBe(true);
  });

  it("show forces a panel visible regardless of prior state", () => {
    usePanelsStore.getState().hide("device");
    usePanelsStore.getState().show("device");
    expect(usePanelsStore.getState().visible.device).toBe(true);
  });

  it("hide forces a panel hidden", () => {
    usePanelsStore.getState().hide("metrics");
    expect(usePanelsStore.getState().visible.metrics).toBe(false);
  });

  it("does not affect other panels when toggling one", () => {
    usePanelsStore.getState().hide("editor");
    const v = usePanelsStore.getState().visible;
    expect(v.editor).toBe(false);
    expect(v.workspace).toBe(true);
    expect(v.console).toBe(true);
  });

  it("migratePanelsStore v0→v1 forces metrics:false even when persisted as true", () => {
    const persisted = {
      visible: {
        workspace: true,
        inspector: true,
        device: true,
        editor: true,
        console: true,
        metrics: true, // old persisted value from before the closed-by-default change
      },
    };
    const result = migratePanelsStore(persisted, 0) as {
      visible: Record<string, boolean>;
    };
    expect(result.visible.metrics).toBe(false);
    // Other flags must be preserved
    expect(result.visible.workspace).toBe(true);
    expect(result.visible.inspector).toBe(true);
    expect(result.visible.device).toBe(true);
    expect(result.visible.editor).toBe(true);
    expect(result.visible.console).toBe(true);
  });

  it("migratePanelsStore v0→v1 tolerates missing visible object", () => {
    const result = migratePanelsStore(null, 0) as {
      visible: Record<string, boolean>;
    };
    expect(result.visible.metrics).toBe(false);
  });

  it("migratePanelsStore is a no-op for current version (fromVersion >= 1)", () => {
    const persisted = {
      visible: { workspace: false, metrics: true },
    };
    const result = migratePanelsStore(persisted, 1);
    // Must return the persisted value unchanged
    expect(result).toBe(persisted);
  });

  it("showAll restores every panel except the metrics tab", () => {
    const s = usePanelsStore.getState();
    s.hide("workspace");
    s.hide("inspector");
    s.hide("device");
    s.showAll();
    const v = usePanelsStore.getState().visible;
    expect(v.workspace).toBe(true);
    expect(v.inspector).toBe(true);
    expect(v.device).toBe(true);
    expect(v.editor).toBe(true);
    expect(v.console).toBe(true);
    // Restoring panels shouldn't silently start metric capture.
    expect(v.metrics).toBe(false);
  });
});
