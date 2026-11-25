// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { AccessibilityReport } from "@/types/accessibility";

/** The last run, as plugins with the `runs` permission see it. Plain JSON:
 *  it crosses postMessage into the plugin frame. */
export interface ReportItem {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number | null;
  error: string | null;
}

export interface RunReport {
  id: string;
  kind: "flow" | "all";
  status: "passed" | "failed" | "stopped";
  title: string;
  startedAt: number;
  durationMs: number;
  project: { name: string; branch: string | null };
  device: { platform: "android" | "ios" | "web" | "cloud"; name: string } | null;
  items: ReportItem[];
  totals: { passed: number; failed: number; skipped: number };
  /** Accessibility pre-audit, present only when the option is enabled. */
  accessibility?: AccessibilityReport;
}

export interface ReportContext {
  id: string;
  kind: "flow" | "all";
  title: string;
  startedAt: number;
  endedAt: number;
  exitCode: number | null;
  stopRequested: boolean;
  project: RunReport["project"];
  device: RunReport["device"];
}
