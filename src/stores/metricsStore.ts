import { create } from "zustand";

export interface Sample {
  ts: number;
  cpuPct: number;
  memMb: number;
  fps: number | null;
  jankPct: number | null;
  netRxKbps: number;
  netTxKbps: number;
}

const MAX_SAMPLES = 60;

interface MetricsState {
  panelOpen: boolean;
  currentPackage: string | null;
  samples: Sample[];
  stoppedReason: string | null;
  togglePanel: () => void;
  setPanelOpen: (v: boolean) => void;
  appendSample: (s: Sample) => void;
  onTargetChanged: (pkg: string) => void;
  setStoppedReason: (r: string | null) => void;
  reset: () => void;
}

export const useMetricsStore = create<MetricsState>((set) => ({
  panelOpen: false,
  currentPackage: null,
  samples: [],
  stoppedReason: null,
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
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
      panelOpen: false,
      currentPackage: null,
      samples: [],
      stoppedReason: null,
    }),
}));
