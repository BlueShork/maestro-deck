// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import LatticeLoader from "@/components/ui/LatticeLoader";
import type { CloudJobPlatform } from "@/lib/cloudJobs";
import { CLOUD_TARGET_LABELS } from "@/lib/cloudRunner";
import { humanLabel } from "@/lib/stepRenderer";
import { cn } from "@/lib/utils";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useRunStore } from "@/stores/runStore";

type Phase = "starting" | "local" | "uploading" | "pending" | "running";
type Verdict = "passed" | "failed" | "stopped";

const WAITING_FOR: Record<CloudJobPlatform, string> = {
  android: "Waiting for a free emulator",
  android_physical: "Waiting for a free phone in the farm",
  ios: "Waiting for a free simulator",
};

/** What the wait is made of, so a long one reads as progress, not a hang. */
const RUNNING_HINT: Record<CloudJobPlatform, string> = {
  android: "The emulator boots first, a few minutes. Its screen shows in the device panel.",
  android_physical: "The log arrives when the run ends.",
  ios: "The simulator boots first. Its screen shows in the device panel.",
};

const VERDICT_COLOR: Record<Verdict, string> = {
  passed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
  stopped: "text-amber-600 dark:text-amber-400",
};

/**
 * The console's "something is happening" row, for local and cloud runs alike.
 *
 * It names what the run is doing — the step in flight locally; the upload,
 * queue or boot in the cloud, where minutes pass with no log — and counts the
 * time, then settles on the verdict: the loader resolves into a check or a
 * cross, and stays until the next run or a Clear.
 */
export function RunStatus() {
  const cloud = useRunStore((s) => s.cloud);
  const starting = useRunStore((s) => s.starting);
  const running = useRunStore((s) => s.running);
  const exitCode = useRunStore((s) => s.exitCode);
  const stopRequested = useRunStore((s) => s.stopRequested);
  const hasLogs = useRunStore((s) => s.logs.length > 0);
  const runningStep = useRunStore((s) => s.steps.find((step) => step.status === "running"));
  const target = useCloudTargetStore((s) => s.target);

  const phase: Phase | null = cloud
    ? cloud.status === "running"
      ? "running"
      : "pending"
    : starting
      ? target
        ? "uploading"
        : "starting"
      : running
        ? "local"
        : null;
  // Where the run happens: a cloud fleet, or null for the local device.
  const platform = phase === "starting" || phase === "local" ? null : target;

  // The store forgets a cloud job the moment it ends (cloud → null), so the
  // verdict is kept here. Adjusted during render, not in an effect: the loader
  // has to stay mounted across the run's last frame to resolve into its check
  // or cross with the stopwatch intact.
  const [session, setSession] = useState<{
    platform: CloudJobPlatform | null;
    verdict: Verdict | null;
  } | null>(null);

  if (phase) {
    if (!session || session.platform !== platform || session.verdict !== null) {
      setSession({ platform, verdict: null });
    }
  } else if (session) {
    if (session.verdict === null && !running) {
      // A null exit code without a stop is "stopped watching" a cloud job or a
      // failed start: no verdict to show, and the console says what happened.
      const verdict: Verdict | null = stopRequested
        ? "stopped"
        : exitCode === null
          ? null
          : exitCode === 0
            ? "passed"
            : "failed";
      setSession(verdict ? { ...session, verdict } : null);
    } else if (!hasLogs) {
      setSession(null); // Clear
    }
  }

  const verdict = phase ? null : session?.verdict;
  if (!phase && !verdict) return null;

  const at = platform ?? session?.platform ?? null;
  const label =
    phase === "starting"
      ? "Starting Maestro"
      : phase === "local"
        ? runningStep
          ? humanLabel(runningStep)
          : "Running the flow"
        : phase === "uploading"
          ? "Uploading the app and flows"
          : phase === "pending" && at
            ? WAITING_FOR[at]
            : at
              ? `Running on ${CLOUD_TARGET_LABELS[at]}`
              : "Running";

  // The executing phase keeps one instance from start to verdict, so the
  // stopwatch it shows at the end is the run's own duration. The waits before
  // it remount, so each counts its own time: "queued for 40s" says more than
  // the time since Run was pressed.
  const executing = !phase || phase === "local" || phase === "running";

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-3 overflow-hidden border-b border-border px-3 py-2",
        verdict ? VERDICT_COLOR[verdict] : "text-blue-600 dark:text-blue-400",
      )}
    >
      <LatticeLoader
        key={executing ? "executing" : phase}
        status={!verdict ? "working" : verdict === "passed" ? "done" : "error"}
        label={label}
        doneLabel="Passed in"
        errorLabel={verdict === "stopped" ? "Stopped after" : "Failed after"}
        errorColor={verdict === "stopped" ? "#f59e0b" : "#ef4444"}
        grid={3}
        pattern={executing ? "orbit" : "snake"}
        fontSize={11}
        cellSize={4}
        gap={2}
      />
      {phase === "running" && at ? (
        <span className="truncate text-[10px] text-muted-foreground">{RUNNING_HINT[at]}</span>
      ) : null}
    </div>
  );
}
