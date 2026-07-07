// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import type { RunReport } from "@/types/visualRegression";

const REVIEWABLE = new Set(["changed", "dimension_mismatch"]);

export interface ReviewState {
  report: RunReport | null;
  queue: string[];
  open: boolean;
  setReport: (r: RunReport | null) => void;
  next: () => void;
  close: () => void;
}

export const useReviewStore = create<ReviewState>((set, get) => ({
  report: null,
  queue: [],
  open: false,
  setReport: (r) => {
    const queue = r ? r.comparisons.filter((c) => REVIEWABLE.has(c.status)).map((c) => c.name) : [];
    set({ report: r, queue, open: queue.length > 0 });
  },
  next: () => {
    const queue = get().queue.slice(1);
    set({ queue, open: queue.length > 0 });
  },
  close: () => set({ open: false, queue: [] }),
}));
