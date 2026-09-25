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
  it("defaults every panel to visible", () => {
    const { visible } = usePanelsStore.getState();
    expect(visible).toEqual({
      workspace: true,
      inspector: true,
      device: true,
      editor: true,
      console: true,
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
    usePanelsStore.getState().hide("console");
    expect(usePanelsStore.getState().visible.console).toBe(false);
  });

  it("does not affect other panels when toggling one", () => {
    usePanelsStore.getState().hide("editor");
    const v = usePanelsStore.getState().visible;
    expect(v.editor).toBe(false);
    expect(v.workspace).toBe(true);
    expect(v.console).toBe(true);
  });

  it.each([0, 1])("migratePanelsStore from v%i drops the old metrics flag", (from) => {
    const persisted = {
      visible: {
        workspace: false,
        inspector: true,
        device: true,
        editor: true,
        console: true,
        metrics: true,
      },
    };
    const result = migratePanelsStore(persisted, from) as {
      visible: Record<string, boolean>;
    };
    expect(result.visible).toEqual({
      workspace: false,
      inspector: true,
      device: true,
      editor: true,
      console: true,
    });
  });

  it("migratePanelsStore tolerates a missing visible object", () => {
    const result = migratePanelsStore(null, 0) as {
      visible: Record<string, boolean>;
    };
    expect(result.visible).toEqual({});
  });

  it("migratePanelsStore is a no-op for the current version", () => {
    const persisted = { visible: { workspace: false } };
    expect(migratePanelsStore(persisted, 2)).toBe(persisted);
  });

  it("showAll restores every panel", () => {
    const s = usePanelsStore.getState();
    s.hide("workspace");
    s.hide("inspector");
    s.hide("device");
    s.showAll();
    expect(Object.values(usePanelsStore.getState().visible).every(Boolean)).toBe(true);
  });
});
