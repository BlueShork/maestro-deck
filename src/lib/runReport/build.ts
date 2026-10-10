// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { StepRunState } from "@/stores/runStore";

import type { SuiteFlowResult } from "./suiteLine";
import type { ReportContext, ReportItem, RunReport } from "./types";

function stepItem(s: StepRunState): ReportItem {
  const status = s.status === "done" ? "passed" : s.status === "failed" ? "failed" : "skipped";
  return {
    name: s.arg ? `${s.command} "${s.arg}"` : s.command,
    status,
    durationMs: status === "skipped" ? null : s.durationMs,
    error: status === "failed" ? s.error : null,
  };
}

const followed = (s: StepRunState) => s.status === "done" || s.status === "failed";

/** A single run reports the open flow's steps; Run All reports Maestro's
 *  per-flow results (the steps only ever track the open file). A single run
 *  whose steps were never followed also falls back on the flow result: the
 *  farm agent runs `maestro test --format JUNIT`, which prints suite lines
 *  (`[Passed] login (6s)`) and no step lines. */
export function buildRunReport(
  ctx: ReportContext,
  steps: StepRunState[],
  flows: SuiteFlowResult[],
): RunReport {
  const useFlows = ctx.kind === "all" || (flows.length > 0 && !steps.some(followed));
  const items = useFlows ? flows.map((f) => ({ ...f })) : steps.map(stepItem);
  const count = (st: ReportItem["status"]) => items.filter((i) => i.status === st).length;
  const totals = { passed: count("passed"), failed: count("failed"), skipped: count("skipped") };
  // No exit code and nothing failed: the outcome is unknown (a cloud run the
  // app stopped watching, or whose result could not be read), not a failure.
  const status =
    ctx.stopRequested || (ctx.exitCode === null && totals.failed === 0)
      ? "stopped"
      : ctx.exitCode === 0 && totals.failed === 0
        ? "passed"
        : "failed";
  return {
    id: ctx.id,
    kind: ctx.kind,
    status,
    title: ctx.title,
    startedAt: ctx.startedAt,
    durationMs: Math.max(0, ctx.endedAt - ctx.startedAt),
    project: ctx.project,
    device: ctx.device,
    items,
    totals,
  };
}
