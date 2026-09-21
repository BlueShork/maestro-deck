// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  CloudJobError,
  fetchArtifactText,
  submitCloudJob,
  type CloudJobPlatform,
} from "@/lib/cloudJobs";
import { watchCloudJob, type CloudWatch } from "@/lib/cloudRun";
import { useRunStore } from "@/stores/runStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** What the fleet actually runs (maestro-nightly/android-docker/docker-compose.yml). */
export const CLOUD_ANDROID_DEVICE = "Galaxy S10 · Android 14";

/** The watch belonging to the run in flight, so Stop can detach from it.
 *  Module-level because a run outlives any component that started it. */
let currentWatch: CloudWatch | null = null;

function line(text: string) {
  useRunStore.getState().appendLog("system", text);
}

/**
 * Runs flows on the cloud instead of a local device.
 *
 * The caller has already written the flow files to disk and initialised the
 * step list, exactly as it does for a local run. From here the shapes diverge:
 * there is no process and no log stream, so progress is a polled status and the
 * console fills in at the end from the run's own log artifact.
 */
export async function startCloudRun(
  platform: CloudJobPlatform,
  yamlPaths: string[],
): Promise<void> {
  const run = useRunStore.getState();
  const apkPath = useWorkspaceStore.getState().cloudApkPath;

  if (!apkPath) {
    // Thrown before anything is sent: no upload, no finalize, no run spent.
    throw new CloudJobError("NO_APK", "Choose the .apk to install on the cloud emulator first.");
  }

  line(
    `[cloud] uploading ${yamlPaths.length === 1 ? "1 flow" : `${yamlPaths.length} flows`} + app…`,
  );

  const { jobId } = await submitCloudJob({ platform, apkPath, yamlPaths });

  run.cloudRunStarted(jobId);
  // Say it plainly: finalize is the moment the balance moves, and the user
  // cannot cancel from here.
  line(`[cloud] job ${jobId} queued — 1 run spent, and it cannot be cancelled`);

  currentWatch = watchCloudJob(jobId, {
    onStatus: (status) => {
      useRunStore.getState().cloudStatusChanged(status);
      if (status === "running") line(`[cloud] running on ${CLOUD_ANDROID_DEVICE}`);
      else if (status === "pending") line("[cloud] waiting for a free emulator…");
    },

    onFinished: (detail) => {
      void (async () => {
        const counts = detail.summary
          ? ` — ${detail.summary.passed}/${detail.summary.total} passed`
          : "";
        line(`[cloud] ${detail.status}${counts}`);

        if (detail.logsUrl) {
          try {
            const log = await fetchArtifactText(detail.logsUrl);
            // Same parser as a local run: the steps light up all at once here,
            // because this is the first moment there is anything to read.
            for (const l of log.split("\n")) useRunStore.getState().ingestLine(l);
          } catch (err) {
            line(`[cloud] the run finished but its log could not be downloaded: ${message(err)}`);
          }
        } else {
          line("[cloud] the run produced no log artifact");
        }

        currentWatch = null;
        useRunStore.getState().setStopped(detail.status === "passed" ? 0 : 1);
      })();
    },

    onGaveUp: (id) => {
      line(`[cloud] no news for 20 minutes — no longer watching job ${id}, which may still finish`);
      currentWatch = null;
      useRunStore.getState().setStopped(null);
    },
  });
}

/**
 * Detaches from a cloud run. Not a cancel: the API has no such endpoint and the
 * run is already paid for, so the job carries on without us.
 */
export function stopWatchingCloudRun(): void {
  const { cloud } = useRunStore.getState();
  currentWatch?.stop();
  currentWatch = null;
  line(
    cloud
      ? `[cloud] stopped watching job ${cloud.jobId} — it keeps running in the cloud`
      : "[cloud] stopped watching",
  );
  useRunStore.getState().setStopped(null);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
