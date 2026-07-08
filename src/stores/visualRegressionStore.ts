// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const DEFAULT_TOLERANCE = 0.1;
export const DEFAULT_THRESHOLD = 0.001;

export interface VisualRegressionState {
  /** Master switch: when false, no screenshot comparison runs after a flow. */
  enabled: boolean;
  tolerance: number | null;
  threshold: number | null;
  /** When true, the status-bar band (clock/notch) is excluded from diffs. */
  ignoreStatusBar: boolean;
  setEnabled: (v: boolean) => void;
  setTolerance: (v: number | null) => void;
  setThreshold: (v: number | null) => void;
  setIgnoreStatusBar: (v: boolean) => void;
  reset: () => void;
}

export const useVisualRegressionStore = create<VisualRegressionState>()(
  persist(
    (set) => ({
      enabled: true,
      tolerance: null,
      threshold: null,
      ignoreStatusBar: false,
      setEnabled: (v) => set({ enabled: v }),
      setTolerance: (v) => set({ tolerance: v }),
      setThreshold: (v) => set({ threshold: v }),
      setIgnoreStatusBar: (v) => set({ ignoreStatusBar: v }),
      reset: () => set({ tolerance: null, threshold: null }),
    }),
    {
      name: "maestro-deck.visual-regression",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export function effectiveThresholds(): { tolerance: number; threshold: number } {
  const { tolerance, threshold } = useVisualRegressionStore.getState();
  return {
    tolerance: tolerance ?? DEFAULT_TOLERANCE,
    threshold: threshold ?? DEFAULT_THRESHOLD,
  };
}
