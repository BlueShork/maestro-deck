// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

export interface Sample {
  ts: number;
  cpuPct: number;
  memMb: number;
  fps: number | null;
  jankPct: number | null;
  frameP50: number | null;
  frameP90: number | null;
  frameP95: number | null;
  frameP99: number | null;
  thermalStatus: number | null;
  netRxKbps: number;
  netTxKbps: number;
}

const MAX_SAMPLES = 60;

interface MetricsState {
  currentPackage: string | null;
  samples: Sample[];
  stoppedReason: string | null;
  appendSample: (s: Sample) => void;
  onTargetChanged: (pkg: string) => void;
  setStoppedReason: (r: string | null) => void;
  reset: () => void;
}

export const useMetricsStore = create<MetricsState>((set) => ({
  currentPackage: null,
  samples: [],
  stoppedReason: null,
  appendSample: (s) =>
    set((state) => {
      const next = [...state.samples, s];
      if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES);
      return { samples: next };
    }),
  onTargetChanged: (pkg) => set({ currentPackage: pkg, samples: [], stoppedReason: null }),
  setStoppedReason: (stoppedReason) => set({ stoppedReason }),
  reset: () =>
    set({
      currentPackage: null,
      samples: [],
      stoppedReason: null,
    }),
}));
