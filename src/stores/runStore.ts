// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import type { Step } from "@/lib/flowAst";
import { parseRunLine, type StepEvent } from "@/lib/runStepParser";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  id: number;
  stream: LogStream;
  text: string;
  timestamp: number;
}

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepRunState {
  index: number;
  line: number;
  endLine: number;
  command: string;
  arg: string | null;
  status: StepStatus;
  startedAt: number | null;
  durationMs: number | null;
  error: string | null;
}

const isSettled = (s: StepRunState): boolean =>
  s.status === "done" || s.status === "failed" || s.status === "skipped";

interface RunState {
  running: boolean;
  /** Optimistic state between the Run click and the runner PID coming back. */
  starting: boolean;
  pid: number | null;
  exitCode: number | null;
  stopRequested: boolean;
  logs: LogLine[];
  truncatedCount: number;
  steps: StepRunState[];
  runTarget: { path: string; kind: "flow" | "all" } | null;
  /** Flow display name to gate on for Run All (config `name:` or file stem).
   *  null = single-flow run, every flow header re-arms matching. */
  expectedFlow: string | null;
  /** False while Run All is executing a flow other than the open file —
   *  its step lines must not touch the editor's step states. */
  flowGateOpen: boolean;
  /** Index of a failed step whose FAILED line carried no message; the next
   *  non-empty unparseable stdout line is its error detail. */
  pendingErrorIdx: number | null;
  setStarting: () => void;
  startFailed: () => void;
  setRunning: (pid: number) => void;
  requestStop: () => void;
  setStopped: (exitCode: number | null) => void;
  setRunTarget: (target: {
    path: string;
    kind: "flow" | "all";
    expectedFlow?: string | null;
  }) => void;
  appendLog: (stream: LogStream, text: string) => void;
  /** Clears the visible console — both the technical `logs` and the Simple
   *  view's `steps`, plus the run-result badge — so "Clear" empties whichever
   *  mode is active rather than just the (often hidden) log buffer. */
  clearConsole: () => void;
  initSteps: (steps: Step[]) => void;
  /** Feed one raw runner stdout line through parse → gate → match. The single
   *  entry point for live progress; applyEvent stays exposed for tests. */
  ingestLine: (raw: string) => void;
  applyEvent: (e: StepEvent) => void;
  resetSteps: () => void;
}

let nextId = 1;

const asPending = (s: StepRunState): StepRunState => ({
  ...s,
  status: "pending",
  startedAt: null,
  durationMs: null,
  error: null,
});

// The plain-text result view (what maestro uses through a pipe) prints leaf
// commands as a single line at COMPLETION — there is no "started" line to
// observe. The running (blue) marker is therefore synthesized: when a step
// settles, the next pending one is what maestro is executing right now.
function promoteNext(steps: StepRunState[], from: number, now: number): void {
  for (let i = from; i < steps.length; i++) {
    if (steps[i].status === "pending") {
      steps[i] = { ...steps[i], status: "running", startedAt: now };
      return;
    }
    if (!isSettled(steps[i])) return; // already running
  }
}

// Match one parsed step event against the step list.
//
// Model (verified against maestro 2.5.1 plain output): execution is strictly
// sequential and every top-level YAML step prints exactly one terminal line at
// depth 0, in order. Container steps (runFlow/repeat/retry) additionally print
// a started line at depth 0 and their children at depth ≥ 1.
//
// So matching is positional first: the target is the cursor (first unsettled
// step). Command-based forward search is only a *resync* aid — it never looks
// backwards, so a re-printed or inner-subflow line can no longer leapfrog onto
// a later step (the historical "wrong lines turn green" bug: inner steps were
// indistinguishable from top-level ones once the indentation was trimmed away,
// and exact-matched later parent steps).
function applyStepEvent(
  state: Pick<RunState, "steps" | "flowGateOpen" | "pendingErrorIdx">,
  e: StepEvent,
): Partial<RunState> | Record<string, never> {
  if (!state.flowGateOpen) return {};
  const next = state.steps.slice();
  const now = performance.now();
  const cursor = next.findIndex((s) => !isSettled(s));
  if (cursor === -1) return {};

  // Inner step of a container (runFlow/repeat/retry) — the cursor step IS the
  // container; keep it blue while its children execute, consume nothing.
  if (e.depth > 0) {
    if (next[cursor].status === "pending") {
      next[cursor] = { ...next[cursor], status: "running", startedAt: now };
      return { steps: next };
    }
    return {};
  }

  // Depth-0 events map 1:1 onto top-level steps, in order → default target is
  // the cursor. When the command is recognized and disagrees with the cursor,
  // resync forward (exact command+arg, then command-only). No forward match →
  // trust order anyway: `label:` overrides and aliased descriptions (e.g.
  // extendedWaitUntil prints as an assertVisible) are still the cursor step.
  let idx = cursor;
  if (e.command !== null && next[cursor].command !== e.command) {
    let fwd = next.findIndex(
      (s, i) =>
        i >= cursor && !isSettled(s) && s.command === e.command && (s.arg ?? "") === (e.arg ?? ""),
    );
    if (fwd === -1) {
      fwd = next.findIndex((s, i) => i >= cursor && !isSettled(s) && s.command === e.command);
    }
    if (fwd !== -1) {
      idx = fwd;
      // Execution is sequential: anything before the matched step already
      // finished, its line just wasn't attributable (silent or reformatted).
      for (let i = cursor; i < idx; i++) {
        if (!isSettled(next[i])) {
          next[i] = { ...next[i], status: "done", durationMs: next[i].durationMs ?? 0 };
        }
      }
    }
  }

  const s = { ...next[idx] };
  let pendingErrorIdx: number | null = null;
  if (e.kind === "started") {
    if (s.status === "pending") {
      s.status = "running";
      s.startedAt = now;
    }
  } else if (e.kind === "completed") {
    s.status = "done";
    s.durationMs = s.startedAt !== null ? now - s.startedAt : 0;
  } else if (e.kind === "skipped") {
    s.status = "skipped";
    s.durationMs = 0;
  } else if (e.kind === "failed") {
    s.status = "failed";
    s.durationMs = s.startedAt !== null ? now - s.startedAt : 0;
    s.error = e.error ?? null;
    // Plain-text FAILED lines carry no message; remember to adopt the next
    // free-text stdout line (e.g. `Assertion is false: ...`) as the error.
    if (!e.error) pendingErrorIdx = idx;
  }
  next[idx] = s;

  if (e.kind === "completed" || e.kind === "skipped") {
    promoteNext(next, idx + 1, now);
  }
  return { steps: next, pendingErrorIdx };
}

export const useRunStore = create<RunState>((set) => ({
  running: false,
  starting: false,
  pid: null,
  exitCode: null,
  stopRequested: false,
  logs: [],
  truncatedCount: 0,
  steps: [],
  runTarget: null,
  expectedFlow: null,
  flowGateOpen: true,
  pendingErrorIdx: null,
  // Posted immediately on the Run click so the toolbar reacts instantly,
  // before the (potentially slow) backend round-trip returns the PID. Clears
  // logs here — the earliest point — so early runner stdout isn't dropped.
  setStarting: () =>
    set({ starting: true, exitCode: null, stopRequested: false, logs: [], truncatedCount: 0 }),
  startFailed: () => set({ starting: false }),
  setRunning: (pid) =>
    set({ running: true, starting: false, pid, exitCode: null, stopRequested: false }),
  requestStop: () => set({ stopRequested: true }),
  setStopped: (exitCode) => set({ running: false, starting: false, pid: null, exitCode }),
  setRunTarget: ({ path, kind, expectedFlow }) =>
    set({
      runTarget: { path, kind },
      expectedFlow: kind === "all" ? (expectedFlow ?? null) : null,
      // Run All starts gated: only the open file's flow may drive the steps.
      flowGateOpen: kind !== "all",
      pendingErrorIdx: null,
    }),
  appendLog: (stream, text) =>
    set((s) => {
      const entry = { id: nextId++, stream, text, timestamp: Date.now() };
      const MAX = 2000;
      if (s.logs.length < MAX) return { logs: [...s.logs, entry] };
      return {
        logs: [...s.logs.slice(s.logs.length - MAX + 1), entry],
        truncatedCount: s.truncatedCount + (s.logs.length - MAX + 1),
      };
    }),
  clearConsole: () =>
    set({ logs: [], steps: [], exitCode: null, stopRequested: false, truncatedCount: 0 }),
  initSteps: (steps) =>
    set({
      steps: steps.map((s) => ({
        index: s.index,
        line: s.line,
        endLine: s.endLine,
        command: s.command,
        arg: s.arg,
        status: "pending" as StepStatus,
        startedAt: null,
        durationMs: null,
        error: null,
      })),
      pendingErrorIdx: null,
    }),
  ingestLine: (raw) =>
    set((state) => {
      const parsed = parseRunLine(raw);

      if (!parsed) {
        // Free-text line: possibly the deferred error detail of a failed step
        // (`Assertion is false: ...` arrives a few lines after `... FAILED`).
        if (state.pendingErrorIdx !== null) {
          const text = raw.trim();
          if (!text) return {};
          const idx = state.pendingErrorIdx;
          const steps = state.steps.slice();
          if (steps[idx] && steps[idx].status === "failed" && steps[idx].error === null) {
            steps[idx] = { ...steps[idx], error: text };
          }
          return { steps, pendingErrorIdx: null };
        }
        return {};
      }

      if (parsed.type === "flow") {
        // ` > Flow <name>` header. For Run All, only the open file's flow may
        // drive the editor/console step states; for a single-flow run every
        // header is ours (the temp-file name never matches the display name,
        // so no name check). Re-arming resets statuses — covers reruns and
        // Run All reaching our flow after several others.
        const gateOpen = state.expectedFlow === null || parsed.name === state.expectedFlow;
        if (!gateOpen) return { flowGateOpen: false, pendingErrorIdx: null };
        const now = performance.now();
        const steps = state.steps.map(asPending);
        // Maestro is already executing the first step — show it running.
        promoteNext(steps, 0, now);
        return { flowGateOpen: true, steps, pendingErrorIdx: null };
      }

      return applyStepEvent(state, parsed.event);
    }),
  applyEvent: (e) => set((state) => applyStepEvent(state, e)),
  resetSteps: () => set({ steps: [], pendingErrorIdx: null }),
}));
