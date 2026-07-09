// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { parseFlow } from "@/lib/flowAst";
import { ipc } from "@/lib/ipc";
import { useFlowStore } from "@/stores/flowStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { ToolSpec } from "@/types/chat";

function joinWs(ws: string, rel: string): string {
  const sep = ws.includes("\\") && !ws.includes("/") ? "\\" : "/";
  return ws.endsWith(sep) ? ws + rel : ws + sep + rel;
}

/** Resolves with the exit code when the current run finishes. */
function waitForExit(): Promise<number | null> {
  return new Promise((resolve) => {
    const check = (s: ReturnType<typeof useRunStore.getState>) => {
      if (!s.running && !s.starting) {
        unsub();
        resolve(s.exitCode);
        return true;
      }
      return false;
    };
    const unsub = useRunStore.subscribe((s) => void check(s));
    check(useRunStore.getState());
  });
}

/** Milliseconds to wait for the runner to stop after an abort before giving up. */
const ABORT_DRAIN_TIMEOUT_MS = 10_000;

export const tools = [
  {
    spec: {
      name: "run_flow",
      description:
        "Run a Maestro flow file on the connected device and wait for it to finish. Returns the exit code and the tail of the run log. Path is relative to the workspace root.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          appId: { type: "string", description: "Optional app id override." },
        },
        required: ["path"],
      },
    } satisfies ToolSpec,
    execute: async (
      input: { path: string; appId?: string },
      signal?: AbortSignal,
    ): Promise<string> => {
      const ws = useWorkspaceStore.getState().folderPath;
      if (!ws) throw new Error("No workspace folder open — ask the user to open one.");
      const run = useRunStore.getState();
      if (run.running || run.starting) {
        throw new Error("A run is already in progress — wait for it to finish or stop it.");
      }
      // Validate + fetch content through the sandbox (also errors on bad paths).
      const content = await ipc.readWorkspaceFile(ws, input.path);
      const abs = joinWs(ws, input.path);

      const store = useRunStore.getState();
      store.setStarting();
      const logWatermark = (() => {
        const logs = useRunStore.getState().logs;
        return logs.length ? logs[logs.length - 1].id : 0;
      })();

      let pid: number;
      try {
        store.resetSteps();
        // Drive the editor highlighting only when Billy runs the open file.
        if (useFlowStore.getState().filePath === abs) {
          store.initSteps(parseFlow(content).steps);
        }
        useRunStore.getState().setRunTarget({ path: abs, kind: "flow" });
        pid = await ipc.runFlow(abs, input.appId ?? useSettingsStore.getState().appId);
        useRunStore.getState().setRunning(pid);
        useRunStore.getState().appendLog("system", `[runner started pid ${pid} · ${abs} (Billy)]`);
      } catch (err) {
        useRunStore.getState().startFailed();
        throw err instanceof Error ? err : new Error(String(err));
      }

      // Race waitForExit() against the AbortSignal so the chat Stop button
      // doesn't leave the loop wedged forever.
      const exitPromise = waitForExit();

      let exitCode: number | null;
      if (!signal) {
        exitCode = await exitPromise;
      } else {
        exitCode = await new Promise<number | null>((resolve) => {
          let settled = false;

          // Listener: resolve immediately when exit arrives normally.
          exitPromise.then((code) => {
            if (!settled) {
              settled = true;
              resolve(code);
            }
          });

          const onAbort = () => {
            if (settled) return;

            // Request stop and send IPC signal; don't throw — we still wait
            // for the runner to exit, but with a bounded timeout.
            useRunStore.getState().requestStop();
            void ipc.stopFlow(pid).catch(() => {});

            // Bounded drain: if the backend dies and runner:exit never fires,
            // give up after ABORT_DRAIN_TIMEOUT_MS and resolve with current state.
            const timer = setTimeout(() => {
              if (!settled) {
                settled = true;
                resolve(useRunStore.getState().exitCode);
              }
            }, ABORT_DRAIN_TIMEOUT_MS);

            exitPromise.then((code) => {
              if (!settled) {
                settled = true;
                clearTimeout(timer);
                resolve(code);
              }
            });
          };

          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
            exitPromise.then(() => {
              signal.removeEventListener("abort", onAbort);
            });
          }
        });
      }

      const { logs, stopRequested } = useRunStore.getState();
      const tail = logs
        .filter((l) => l.id > logWatermark)
        .slice(-80)
        .map((l) => l.text)
        .join("\n");
      return JSON.stringify({ exitCode, stoppedByUser: stopRequested, tail });
    },
  },
];
