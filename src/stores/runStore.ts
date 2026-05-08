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
  pid: number | null;
  exitCode: number | null;
  stopRequested: boolean;
  logs: LogLine[];
  steps: StepRunState[];
  setRunning: (pid: number) => void;
  requestStop: () => void;
  setStopped: (exitCode: number | null) => void;
  appendLog: (stream: LogStream, text: string) => void;
  clearLogs: () => void;
  initSteps: (steps: Step[]) => void;
  applyEvent: (e: StepEvent) => void;
  resetSteps: () => void;
}

let nextId = 1;

function pickIndex(steps: StepRunState[], command: string, arg: string | null): number | null {
  let firstAny: number | null = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.command !== command) continue;
    if ((s.arg ?? "") !== (arg ?? "")) continue;
    if (firstAny === null) firstAny = i;
    if (s.status === "pending" || s.status === "running") return i;
  }
  return firstAny;
}

export const useRunStore = create<RunState>((set) => ({
  running: false,
  pid: null,
  exitCode: null,
  stopRequested: false,
  logs: [],
  steps: [],
  setRunning: (pid) => set({ running: true, pid, exitCode: null, stopRequested: false, logs: [] }),
  requestStop: () => set({ stopRequested: true }),
  setStopped: (exitCode) => set({ running: false, pid: null, exitCode }),
  appendLog: (stream, text) =>
    set((s) => {
      const entry = { id: nextId++, stream, text, timestamp: Date.now() };
      const MAX = 2000;
      if (s.logs.length < MAX) return { logs: [...s.logs, entry] };
      return { logs: [...s.logs.slice(s.logs.length - MAX + 1), entry] };
    }),
  clearLogs: () => set({ logs: [] }),
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
      const idx = pickIndex(state.steps, e.command, e.arg);
      if (idx === null) return {};
      const next = state.steps.slice();
      const s = { ...next[idx] };
      const now = performance.now();
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
