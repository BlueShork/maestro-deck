import { create } from "zustand";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  id: number;
  stream: LogStream;
  text: string;
  timestamp: number;
}

interface RunState {
  running: boolean;
  pid: number | null;
  exitCode: number | null;
  stopRequested: boolean;
  logs: LogLine[];
  setRunning: (pid: number) => void;
  requestStop: () => void;
  setStopped: (exitCode: number | null) => void;
  appendLog: (stream: LogStream, text: string) => void;
  clearLogs: () => void;
}

let nextId = 1;

export const useRunStore = create<RunState>((set) => ({
  running: false,
  pid: null,
  exitCode: null,
  stopRequested: false,
  logs: [],
  setRunning: (pid) =>
    set({ running: true, pid, exitCode: null, stopRequested: false, logs: [] }),
  requestStop: () => set({ stopRequested: true }),
  setStopped: (exitCode) => set({ running: false, pid: null, exitCode }),
  appendLog: (stream, text) =>
    set((s) => {
      const entry = { id: nextId++, stream, text, timestamp: Date.now() };
      // Below the cap: just copy + push. Above: drop the oldest in the
      // same allocation instead of splicing a fresh spread.
      const MAX = 2000;
      if (s.logs.length < MAX) {
        return { logs: [...s.logs, entry] };
      }
      // Drop oldest, keep last MAX-1, append new. One slice, not two.
      return { logs: [...s.logs.slice(s.logs.length - MAX + 1), entry] };
    }),
  clearLogs: () => set({ logs: [] }),
}));
