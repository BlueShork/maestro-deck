// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { flowDisplayName } from "@/lib/flowAst";
import { ipc } from "@/lib/ipc";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFlowStore } from "@/stores/flowStore";
import { useRunReportStore } from "@/stores/runReportStore";
import { useRunStore } from "@/stores/runStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { buildRunReport } from "./build";
import type { RunReport } from "./types";

const baseName = (p: string) =>
  p
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() ?? p;

function currentDevice(): RunReport["device"] {
  const cloud = useCloudTargetStore.getState().target;
  if (cloud) return { platform: "cloud", name: `Maestro Deck Cloud · ${cloud.replace("_", " ")}` };
  const d = useDeviceStore.getState().current;
  return d ? { platform: d.platform, name: d.model } : null;
}

// "Run" on an unsaved buffer and "Run from here" execute this temp copy of the
// open flow (MainView), so the open flow's name still applies.
const TEMP_FLOW = "maestro-deck-flow.yaml";

function flowTitle(target: string | undefined): string {
  const { content, filePath } = useFlowStore.getState();
  if (target && target !== filePath && baseName(target) !== TEMP_FLOW) {
    return baseName(target).replace(/\.ya?ml$/i, "");
  }
  return flowDisplayName(content, filePath) ?? "Flow";
}

/**
 * Watches runStore and records a RunReport when a run ends. A run "begins" on
 * the Run click (starting) and "ends" when it was running and no longer is;
 * a start that failed before running never ends, so it is never reported.
 */
export function startRunReportTracking(): () => void {
  let startedAt = 0;
  let device: RunReport["device"] = null;
  // Runs that ended so far; a report whose branch lookup resolves after a
  // newer run ended is stale and dropped.
  let ended = 0;

  return useRunStore.subscribe((s, prev) => {
    if (s.starting && !prev.starting) {
      startedAt = Date.now();
      device = currentDevice();
      useRunReportStore.getState().begin();
      return;
    }
    if (!(prev.running && !s.running)) return;

    const endedAt = Date.now();
    const run = ++ended;
    const began = startedAt;
    const ranOn = device;
    const kind = s.runTarget?.kind ?? "flow";
    const folder = useWorkspaceStore.getState().folderPath;
    const title =
      kind === "all"
        ? baseName(s.runTarget?.path ?? folder ?? "Run All")
        : flowTitle(s.runTarget?.path);
    const steps = s.steps;
    const flows = useRunReportStore.getState().flows;
    const { exitCode, stopRequested } = s;
    const branch = folder
      ? ipc.workspaceGitBranch(folder).catch(() => null)
      : Promise.resolve(null);

    void branch.then((b) => {
      if (run !== ended) return;
      useRunReportStore.getState().finish(
        buildRunReport(
          {
            id: crypto.randomUUID(),
            kind,
            title,
            startedAt: began,
            endedAt,
            exitCode,
            stopRequested,
            project: { name: folder ? baseName(folder) : title, branch: b },
            device: ranOn,
          },
          steps,
          flows,
        ),
      );
    });
  });
}
