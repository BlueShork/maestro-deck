// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import { parseSuiteLine, type SuiteFlowResult } from "@/lib/runReport/suiteLine";
import type { RunReport } from "@/lib/runReport/types";

interface RunReportState {
  /** The last finished run. In memory only: one report, the latest. */
  last: RunReport | null;
  /** Per-flow results of the run in progress. Collected from the raw runner
   *  lines, not from runStore.logs, which drops lines past 2000. */
  flows: SuiteFlowResult[];
  begin: () => void;
  ingest: (line: string) => void;
  finish: (report: RunReport) => void;
}

export const useRunReportStore = create<RunReportState>((set) => ({
  last: null,
  flows: [],
  begin: () => set({ flows: [] }),
  ingest: (line) => {
    const flow = parseSuiteLine(line);
    if (flow) set((s) => ({ flows: [...s.flows, flow] }));
  },
  finish: (last) => set({ last }),
}));
