// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";

import { useVisualRegressionStore } from "@/stores/visualRegressionStore";

describe("visualRegressionStore ignoreStatusBar", () => {
  it("defaults to false", () => {
    expect(useVisualRegressionStore.getState().ignoreStatusBar).toBe(false);
  });

  it("can be toggled via setIgnoreStatusBar", () => {
    useVisualRegressionStore.getState().setIgnoreStatusBar(true);
    expect(useVisualRegressionStore.getState().ignoreStatusBar).toBe(true);
    useVisualRegressionStore.getState().setIgnoreStatusBar(false);
    expect(useVisualRegressionStore.getState().ignoreStatusBar).toBe(false);
  });
});
