// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import type { Step } from "@/lib/flowAst";
import type { StepEvent } from "@/lib/runStepParser";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  id: number;
  stream: LogStream;
  text: string;
  timestamp: number;
}

export type StepStatus = "pending" | "running" | "done" | "failed";

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

interface RunState {
  running: boolean;
  /** Optimistic state between the Run click and the runner PID coming back. */
  starting: boolean;
  pid: number | null;
  exitCode: number | null;
  stopRequested: boolean;
  logs: LogLine[];
  steps: StepRunState[];
  runTarget: { path: string; kind: "flow" | "all" } | null;
  setStarting: () => void;
  startFailed: () => void;
  setRunning: (pid: number) => void;
  requestStop: () => void;
  setStopped: (exitCode: number | null) => void;
  setRunTarget: (target: { path: string; kind: "flow" | "all" }) => void;
  appendLog: (stream: LogStream, text: string) => void;
  /** Clears the visible console — both the technical `logs` and the Simple
   *  view's `steps`, plus the run-result badge — so "Clear" empties whichever
   *  mode is active rather than just the (often hidden) log buffer. */
  clearConsole: () => void;
  initSteps: (steps: Step[]) => void;
  applyEvent: (e: StepEvent) => void;
  resetSteps: () => void;
}

let nextId = 1;

export const useRunStore = create<RunState>((set) => ({
  running: false,
  starting: false,
  pid: null,
  exitCode: null,
  stopRequested: false,
  logs: [],
  steps: [],
  runTarget: null,
  // Posted immediately on the Run click so the toolbar reacts instantly,
  // before the (potentially slow) backend round-trip returns the PID. Clears
  // logs here — the earliest point — so early runner stdout isn't dropped.
  setStarting: () => set({ starting: true, exitCode: null, stopRequested: false, logs: [] }),
  startFailed: () => set({ starting: false }),
  setRunning: (pid) =>
    set({ running: true, starting: false, pid, exitCode: null, stopRequested: false }),
  requestStop: () => set({ stopRequested: true }),
  setStopped: (exitCode) => set({ running: false, starting: false, pid: null, exitCode }),
  setRunTarget: (runTarget) => set({ runTarget }),
  appendLog: (stream, text) =>
    set((s) => {
      const entry = { id: nextId++, stream, text, timestamp: Date.now() };
      const MAX = 2000;
      if (s.logs.length < MAX) return { logs: [...s.logs, entry] };
      return { logs: [...s.logs.slice(s.logs.length - MAX + 1), entry] };
    }),
  clearConsole: () => set({ logs: [], steps: [], exitCode: null, stopRequested: false }),
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
    }),
  applyEvent: (e) =>
    set((state) => {
      // Maestro inlines the steps of a `runFlow` subflow without emitting
      // any "Run flow ..." header line — so the parent's runFlow step
      // never gets a direct event. Resolution chain:
      //   1. Try EXACT (command + arg) match against still-pending steps.
      //   2. If no exact match AND cursor sits on a runFlow → it's an
      //      inner subflow step. Mark runFlow as running, don't consume.
      //   3. Otherwise fall back to "first pending step with same command"
      //      (handles arg differences like `text:` vs displayed value).
      // Whenever a parent step matches, any pending runFlows BEFORE it
      // are implicitly closed — their subflows must have finished for
      // execution to be back in the parent.
      const next = state.steps.slice();
      const now = performance.now();
      const cursor = next.findIndex((s) => s.status === "pending" || s.status === "running");

      // Step 1 — exact match.
      let idx = next.findIndex(
        (s) =>
          s.command === e.command &&
          (s.arg ?? "") === (e.arg ?? "") &&
          (s.status === "pending" || s.status === "running"),
      );

      // Step 2 — inner subflow heuristic.
      if (idx === -1 && cursor !== -1 && next[cursor].command === "runFlow") {
        const s = { ...next[cursor] };
        if (s.status === "pending") {
          s.status = "running";
          s.startedAt = now;
          next[cursor] = s;
        }
        return { steps: next };
      }

      // Step 3 — fuzzy command-only fallback.
      if (idx === -1) {
        idx = next.findIndex(
          (s) => s.command === e.command && (s.status === "pending" || s.status === "running"),
        );
      }

      if (idx === -1) {
        // Genuinely unmatchable — drop silently.
        return {};
      }

      // Close any pending runFlow strictly before the matched step.
      const closeFrom = cursor === -1 ? 0 : cursor;
      for (let i = closeFrom; i < idx; i++) {
        if (next[i].command === "runFlow" && next[i].status !== "done") {
          next[i] = { ...next[i], status: "done" as StepStatus, durationMs: 0 };
        }
      }

      const s = { ...next[idx] };
      if (e.kind === "started") {
        s.status = "running";
        s.startedAt = now;
      } else if (e.kind === "completed") {
        s.status = "done";
        s.durationMs = s.startedAt !== null ? now - s.startedAt : 0;
      } else if (e.kind === "failed") {
        s.status = "failed";
        s.durationMs = s.startedAt !== null ? now - s.startedAt : 0;
        s.error = e.error ?? null;
      }
      next[idx] = s;
      return { steps: next };
    }),
  resetSteps: () => set({ steps: [] }),
}));
