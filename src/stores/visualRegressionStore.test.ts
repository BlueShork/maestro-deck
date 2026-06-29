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

import {
  useVisualRegressionStore,
  effectiveThresholds,
  DEFAULT_TOLERANCE,
  DEFAULT_THRESHOLD,
} from "@/stores/visualRegressionStore";

describe("visualRegressionStore", () => {
  beforeEach(() => useVisualRegressionStore.getState().reset());

  it("returns defaults when unset", () => {
    expect(effectiveThresholds()).toEqual({
      tolerance: DEFAULT_TOLERANCE,
      threshold: DEFAULT_THRESHOLD,
    });
  });

  it("uses custom values when set", () => {
    useVisualRegressionStore.getState().setTolerance(0.2);
    useVisualRegressionStore.getState().setThreshold(0.05);
    expect(effectiveThresholds()).toEqual({ tolerance: 0.2, threshold: 0.05 });
  });

  it("is enabled by default and toggles", () => {
    expect(useVisualRegressionStore.getState().enabled).toBe(true);
    useVisualRegressionStore.getState().setEnabled(false);
    expect(useVisualRegressionStore.getState().enabled).toBe(false);
  });
});
