// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import LatticeLoader from "@/components/ui/LatticeLoader";
import type { CloudJobPlatform } from "@/lib/cloudJobs";
import { CLOUD_TARGET_LABELS } from "@/lib/cloudRunner";
import { cn } from "@/lib/utils";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useRunStore } from "@/stores/runStore";

type Phase = "uploading" | "pending" | "running";

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

/**
 * The console's "something is happening" row for a cloud run.
 *
 * A cloud run is minutes of silence: an upload, a queue, a VM and an emulator
 * booting, and the log only arrives at the end. This row names the phase and
 * counts the time in it, then settles on the verdict — the loader resolves
 * into a check or a cross — until the next run or a Clear.
 */
export function CloudRunStatus() {
  const cloud = useRunStore((s) => s.cloud);
  const starting = useRunStore((s) => s.starting);
  const running = useRunStore((s) => s.running);
  const exitCode = useRunStore((s) => s.exitCode);
  const hasLogs = useRunStore((s) => s.logs.length > 0);
  const target = useCloudTargetStore((s) => s.target);

  const phase: Phase | null = cloud
    ? cloud.status === "running"
      ? "running"
      : "pending"
    : starting && target
      ? "uploading"
      : null;

  // The store forgets the job the moment it ends (cloud → null), so the run's
  // platform and verdict are kept here. Adjusted during render, not in an
  // effect: the loader has to stay mounted across the last frame of the run to
  // resolve into its check or cross with the stopwatch intact.
  const [session, setSession] = useState<{
    platform: CloudJobPlatform;
    passed: boolean | null;
  } | null>(null);

  if (phase && target) {
    if (session?.platform !== target || session.passed !== null) {
      setSession({ platform: target, passed: null });
    }
  } else if (session) {
    if (session.passed === null && !running) {
      // "Stopped watching" ends with a null exit code: no verdict to show, and
      // the console already says what happened.
      setSession(exitCode === null ? null : { ...session, passed: exitCode === 0 });
    } else if ((running && !cloud) || !hasLogs) {
      // A local run or a Clear takes the row away.
      setSession(null);
    }
  }

  const platform = phase ? target : session?.platform;
  if (!platform || (!phase && session?.passed == null)) return null;

  const label =
    phase === "uploading"
      ? "Uploading the app and flows"
      : phase === "pending"
        ? WAITING_FOR[platform]
        : `Running on ${CLOUD_TARGET_LABELS[platform]}`;

  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-border px-3 py-2",
        phase
          ? "text-blue-600 dark:text-blue-400"
          : session?.passed
            ? "text-emerald-600 dark:text-emerald-400"
            : "text-red-600 dark:text-red-400",
      )}
    >
      <LatticeLoader
        // A new phase restarts the stopwatch: "queued for 40s" says more than
        // the time since Run was pressed. The running phase keeps its instance
        // so it can resolve into the verdict.
        key={phase === "running" || !phase ? "running" : phase}
        status={phase ? "working" : session?.passed ? "done" : "error"}
        label={label}
        doneLabel="Passed in"
        errorLabel="Failed after"
        grid={3}
        pattern={phase === "running" || !phase ? "orbit" : "snake"}
        fontSize={11}
        cellSize={4}
        gap={2}
      />
      {phase === "running" ? (
        <span className="truncate text-[10px] text-muted-foreground">{RUNNING_HINT[platform]}</span>
      ) : null}
    </div>
  );
}
