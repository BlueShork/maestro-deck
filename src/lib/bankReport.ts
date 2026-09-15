// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { RunReport } from "@/types/visualRegression";

export interface BankSummary {
  matched: number;
  reviewable: number;
  seeded: number;
  missing: number;
  /** Lines for the app console, already prefixed with [bank]. */
  logLines: string[];
  toast: { kind: "info" | "success"; title: string; detail: string };
}

/** Pure digest of a comparison report — drives the console lines and the
 *  end-of-check toast for both single-flow and Run All comparisons. */
export function summarizeBankReport(report: RunReport): BankSummary {
  const comps = report.comparisons;
  const matched = comps.filter((c) => c.status === "match").length;
  const reviewable = comps.filter(
    (c) => c.status === "changed" || c.status === "dimension_mismatch",
  ).length;
  const seeded = comps.filter((c) => c.status === "seeded").length;
  const missing = comps.filter((c) => c.status === "missing").length;

  const logLines: string[] = [];
  if (seeded > 0) logLines.push(`[bank] ${seeded} reference screenshot(s) created`);
  if (missing > 0) logLines.push(`[bank] ${missing} expected screenshot(s) missing`);
  logLines.push(
    `[bank] ${matched} match · ${reviewable} changed · ${seeded} new · ${missing} missing`,
  );

  const flows = [...new Set(comps.map((c) => c.flow).filter(Boolean))] as string[];
  if (flows.length > 1) {
    const byFlow = flows
      .map((f) => `${f}: ${comps.filter((c) => c.flow === f).length}`)
      .join(" · ");
    logLines.push(`[bank] flows — ${byFlow}`);
  }
  for (const err of report.flow_errors ?? []) {
    logLines.push(`[bank] ${err}`);
  }

  if (reviewable > 0) {
    return {
      matched,
      reviewable,
      seeded,
      missing,
      logLines,
      toast: {
        kind: "info",
        title: "Screenshot changes detected",
        detail: `${reviewable} screenshot(s) need review — opening…`,
      },
    };
  }
  const parts: string[] = [];
  if (matched > 0) parts.push(`${matched} match`);
  if (seeded > 0) parts.push(`${seeded} new`);
  if (missing > 0) parts.push(`${missing} missing`);
  return {
    matched,
    reviewable,
    seeded,
    missing,
    logLines,
    toast: {
      kind: "success",
      title: "Screenshot bank ✓",
      detail: parts.length ? parts.join(" · ") : "No screenshots in this flow",
    },
  };
}
