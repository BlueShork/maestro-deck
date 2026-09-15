// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { parseRunLine } from "@/lib/runStepParser";

export interface RunFailure {
  command: string | null;
  arg: string | null;
  error: string | null;
  line: number | null;
}

/** Parse a run-log tail for the first failed step. Mirrors the runStore's
 *  deferred-detail convention: a FAILED line carries no message; the next
 *  non-empty unparseable line is its error detail. */
export function extractFailure(tailLines: string[]): RunFailure | null {
  for (let i = 0; i < tailLines.length; i++) {
    const parsed = parseRunLine(tailLines[i]);
    if (!parsed || parsed.type !== "step" || parsed.event.kind !== "failed") continue;
    const e = parsed.event;
    let error: string | null = e.error ?? null;
    if (!error) {
      for (let j = i + 1; j < tailLines.length; j++) {
        const next = tailLines[j].trim();
        if (!next) continue;
        if (parseRunLine(tailLines[j])) break; // next structured line — no detail
        error = next;
        break;
      }
    }
    return { command: e.command, arg: e.arg, error, line: null };
  }
  return null;
}
