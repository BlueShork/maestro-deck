// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { summarizeBankReport } from "@/lib/bankReport";
import { ipc } from "@/lib/ipc";
import { track } from "@/lib/telemetry";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudInviteStore } from "@/stores/cloudInviteStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useReviewStore } from "@/stores/reviewStore";
import { useRunStore } from "@/stores/runStore";
import { toast } from "@/stores/toastStore";
import { effectiveThresholds, useVisualRegressionStore } from "@/stores/visualRegressionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** Delay before the cloud offer, so the success toast lands first — the ask
 *  should follow the win, not cover it. */
export const CLOUD_INVITE_DELAY_MS = 1600;

/**
 * Everything that follows the runner process exiting: the console line, the
 * run state, the outcome toast and telemetry, the one-time cloud offer and —
 * when visual regression is on — the screenshot bank comparison.
 */
export function handleRunnerExit(code: number | null): void {
  const run = useRunStore.getState();
  const wasStopped = run.stopRequested;
  const exitedPid = run.pid;
  run.appendLog(
    "system",
    wasStopped ? "[runner stopped by user]" : `[runner exited with code ${code}]`,
  );
  run.setStopped(code);
  const ranOn = useDeviceStore.getState().current;
  track("flow_run_finished", {
    platform: ranOn?.platform ?? "unknown",
    physical: ranOn?.physical ?? false,
    scope: useRunStore.getState().runTarget?.kind ?? "unknown",
    outcome: wasStopped ? "stopped" : code === 0 ? "passed" : "failed",
  });
  if (wasStopped) toast.success("Flow stopped");
  else if (code === 0) toast.success("Flow completed");
  else toast.error("Flow failed", `exit code ${code}`);

  const passed = code === 0 && !wasStopped;
  // First run that actually worked, and only for signed-out users: the one
  // moment the cloud offer is worth hearing.
  if (passed && !useCloudAuthStore.getState().user) {
    setTimeout(() => {
      if (!useCloudAuthStore.getState().user) useCloudInviteStore.getState().offer();
    }, CLOUD_INVITE_DELAY_MS);
  }
  if (passed && useVisualRegressionStore.getState().enabled) {
    checkScreenshotBank(String(exitedPid ?? Date.now()));
  }
}

function checkScreenshotBank(runId: string): void {
  const target = useRunStore.getState().runTarget;
  const ws = useWorkspaceStore.getState().folderPath;
  const device = useDeviceStore.getState().current;
  if (!(target?.kind === "all" || target?.kind === "flow") || !ws || !device) return;
  const { appendLog } = useRunStore.getState();
  const { tolerance, threshold } = effectiveThresholds();
  const bankToastId = toast.loading(
    "Checking screenshot bank…",
    "Comparing captures against their baselines",
  );
  appendLog("system", "[bank] verifying screenshots against the bank…");
  const common = {
    workspace: ws,
    model: device.model,
    width: device.screen_width,
    height: device.screen_height,
    tolerance,
    threshold,
    runId,
    platform: device.platform,
    ignoreStatusBar: useVisualRegressionStore.getState().ignoreStatusBar,
  };
  track("screenshot_bank_checked", { scope: target.kind });
  const compare =
    target.kind === "all"
      ? ipc.compareScreenshotsAll(common)
      : ipc.compareScreenshots({ ...common, flowPath: target.path });
  void compare
    .then((report) => {
      toast.dismiss(bankToastId);
      const summary = summarizeBankReport(report);
      summary.logLines.forEach((l) => appendLog("system", l));
      if (summary.toast.kind === "info") toast.info(summary.toast.title, summary.toast.detail);
      else toast.success(summary.toast.title, summary.toast.detail);
      useReviewStore.getState().setReport(report);
    })
    .catch((err) => {
      toast.dismiss(bankToastId);
      toast.error("Screenshot bank check failed", String(err));
      appendLog("system", `[bank] comparison failed: ${String(err)}`);
    });
}
