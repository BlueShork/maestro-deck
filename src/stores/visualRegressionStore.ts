// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export const DEFAULT_TOLERANCE = 0.1;
export const DEFAULT_THRESHOLD = 0.001;

export interface VisualRegressionState {
  tolerance: number | null;
  threshold: number | null;
  setTolerance: (v: number | null) => void;
  setThreshold: (v: number | null) => void;
  reset: () => void;
}

export const useVisualRegressionStore = create<VisualRegressionState>()(
  persist(
    (set) => ({
      tolerance: null,
      threshold: null,
      setTolerance: (v) => set({ tolerance: v }),
      setThreshold: (v) => set({ threshold: v }),
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
