// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { parseRunLine } from "@/lib/runStepParser";

import type { SuiteFlowResult } from "./suiteLine";

/**
 * Per-flow results rebuilt from the plain output, for Run All runs where
 * Maestro prints no `[Passed] name (5s)` suite lines (2.10 without --format):
 * ` > Flow <name>` opens a flow, a FAILED step fails it, and the first free
 * text line after a FAILED one is its error, as in the step tracker.
 */

interface OpenFlow {
  name: string;
  at: number;
  failed: boolean;
  error: string | null;
  failedStep: string | null;
  awaitingDetail: boolean;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b?\[[0-9;]*[A-Za-z]/g;

export function createFlowLog() {
  const flows: OpenFlow[] = [];
  const current = () => flows[flows.length - 1] as OpenFlow | undefined;

  return {
    feed(raw: string, at: number) {
      const parsed = parseRunLine(raw);
      const flow = current();
      if (parsed?.type === "flow") {
        flows.push({
          name: parsed.name,
          at,
          failed: false,
          error: null,
          failedStep: null,
          awaitingDetail: false,
        });
        return;
      }
      if (!flow) return;
      if (parsed?.type === "step") {
        flow.awaitingDetail = false;
        if (parsed.event.kind === "failed" && !flow.failed) {
          flow.failed = true;
          flow.error = parsed.event.error ?? null;
          flow.failedStep = raw
            .replace(ANSI, "")
            .trim()
            .replace(/\.\.\.\s+FAILED.*$/, "");
          flow.awaitingDetail = flow.error === null;
        }
        return;
      }
      const text = raw.replace(ANSI, "").trim();
      if (flow.awaitingDetail && text && !text.startsWith(">")) {
        flow.error = text;
        flow.awaitingDetail = false;
      }
    },

    finish(end: { at: number; exitCode: number | null; stopped: boolean }): SuiteFlowResult[] {
      const results: SuiteFlowResult[] = flows.map((f, i) => ({
        name: f.name,
        status: f.failed ? "failed" : "passed",
        durationMs: (flows[i + 1]?.at ?? end.at) - f.at,
        error: f.failed ? (f.error ?? `${f.failedStep} failed`) : null,
      }));
      const last = results[results.length - 1];
      if (!last || last.status === "failed") return results;
      // The last flow was the one running when the run ended.
      if (end.stopped) return results.slice(0, -1);
      if (end.exitCode !== 0 && !results.some((r) => r.status === "failed")) {
        last.status = "failed";
      }
      return results;
    },
  };
}
