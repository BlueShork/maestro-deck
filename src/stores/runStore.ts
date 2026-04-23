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
      const next = [
        ...s.logs,
        { id: nextId++, stream, text, timestamp: Date.now() },
      ];
      if (next.length > 2000) next.splice(0, next.length - 2000);
      return { logs: next };
    }),
  clearLogs: () => set({ logs: [] }),
}));
