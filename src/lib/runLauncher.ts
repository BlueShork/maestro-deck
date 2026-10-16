// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { join, tempDir } from "@tauri-apps/api/path";
import { writeTextFile } from "@tauri-apps/plugin-fs";

import { startCloudRun, stopWatchingCloudRun } from "@/lib/cloudRunner";
import { flowDisplayName, parseFlow, type Step } from "@/lib/flowAst";
import { writeFlow } from "@/lib/flow-io";
import { ipc } from "@/lib/ipc";
import { buildPartialFlow } from "@/lib/partialFlow";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useFlowStore } from "@/stores/flowStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** The copy of the open flow that "Run" on an unsaved buffer and "Run from
 *  here" execute. runReport/track.ts recognises it by this name. */
const TEMP_FLOW_NAME = "maestro-deck-flow.yaml";

const tempFlowPath = async () => join(await tempDir(), TEMP_FLOW_NAME);

function busy(): boolean {
  const { running, starting } = useRunStore.getState();
  return running || starting;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function spawnLocal(path: string, label: string): Promise<void> {
  const pid = await ipc.runFlow(
    path,
    useSettingsStore.getState().appId,
    useWorkspaceStore.getState().folderPath,
  );
  useRunStore.getState().setRunning(pid);
  useRunStore.getState().appendLog("system", `[runner started pid ${pid} · ${label}]`);
}

function armSteps(steps: Step[]): void {
  const run = useRunStore.getState();
  run.resetSteps();
  run.initSteps(steps);
}

/** Runs the open flow — on disk if it has a file (saving it first), else from
 *  a temp copy — on the connected device or the chosen cloud target. */
export async function runOpenFlow(): Promise<void> {
  if (busy()) return;
  const { content, filePath } = useFlowStore.getState();
  useRunStore.getState().setStarting();
  try {
    let path: string;
    if (filePath) {
      path = filePath;
      await writeFlow(path);
    } else {
      path = await tempFlowPath();
      await writeTextFile(path, content);
    }
    armSteps(parseFlow(content).steps);
    useRunStore.getState().setRunTarget({ path, kind: "flow" });
    const cloudTarget = useCloudTargetStore.getState().target;
    if (cloudTarget) {
      await startCloudRun(cloudTarget, [path]);
      return;
    }
    await spawnLocal(path, path);
  } catch (err) {
    useRunStore.getState().startFailed();
    toast.error("Run failed", message(err));
  }
}

/** Runs every flow of the workspace folder in one runner process. Only the
 *  open file's flow drives the editor's step states. */
export async function runAllFlows(): Promise<void> {
  const folder = useWorkspaceStore.getState().folderPath;
  if (!folder || busy()) return;
  useRunStore.getState().setStarting();
  try {
    // Persist any unsaved edits to the current file so they're part of the run.
    const { filePath, dirty } = useFlowStore.getState();
    if (dirty && filePath) await writeFlow(filePath);
    const { content, filePath: openPath } = useFlowStore.getState();
    armSteps(parseFlow(content).steps);
    useRunStore.getState().setRunTarget({
      path: folder,
      kind: "all",
      expectedFlow: flowDisplayName(content, openPath),
    });
    await spawnLocal(folder, `all flows in ${folder}`);
  } catch (err) {
    useRunStore.getState().startFailed();
    toast.error("Run all failed", message(err));
  }
}

/** Runs the open flow from the step at `line` onwards, keeping the step
 *  highlights on the original line numbers. */
export async function runFromLine(line: number): Promise<void> {
  const partial = buildPartialFlow(useFlowStore.getState().content, line);
  if (!partial || busy()) return;
  useRunStore.getState().setStarting();
  try {
    const path = await tempFlowPath();
    await writeTextFile(path, partial.content);
    armSteps(
      parseFlow(partial.content).steps.map((s) => ({
        ...s,
        line: partial.lineMap.get(s.line) ?? s.line,
      })),
    );
    useRunStore.getState().setRunTarget({ path, kind: "flow" });
    await spawnLocal(path, `from line ${partial.firstStepOriginalLine}`);
  } catch (err) {
    useRunStore.getState().startFailed();
    toast.error("Run from here failed", message(err));
  }
}

/** Stops the run in progress. A cloud run has no local process and no cancel
 *  endpoint: the most the app can do is stop watching, and it says so. */
export async function stopRun(): Promise<void> {
  if (useRunStore.getState().cloud) {
    stopWatchingCloudRun();
    return;
  }
  const pid = useRunStore.getState().pid;
  if (pid === null) return;
  useRunStore.getState().requestStop();
  try {
    await ipc.stopFlow(pid);
  } catch (err) {
    toast.error("Stop failed", message(err));
  }
}
