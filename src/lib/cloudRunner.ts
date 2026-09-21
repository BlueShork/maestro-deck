// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  CloudJobError,
  fetchArtifactText,
  submitCloudJob,
  type CloudJobPlatform,
} from "@/lib/cloudJobs";
import { runVerdict, watchCloudJob, type CloudWatch } from "@/lib/cloudRun";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useRunStore } from "@/stores/runStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** What each fleet actually runs. The emulator is a fixed profile
 *  (maestro-nightly/android-docker/docker-compose.yml); the farm's phone is
 *  whichever one is idle when the worker claims the job, and nothing in the
 *  API tells us which — the job's claimedBy is not exposed. */
export const CLOUD_TARGET_LABELS: Record<CloudJobPlatform, string> = {
  android: "Galaxy S10 · Android 14",
  android_physical: "a phone in the device farm",
  ios: "the hosted iOS simulator",
};

/**
 * The artefact each fleet installs, and how to talk about it. Android takes an
 * .apk; iOS takes a **simulator** build — the worker unzips the archive and
 * looks for a *.app inside, so an .ipa or a device build fails there, after the
 * run has been charged.
 */
export const CLOUD_ARTIFACTS: Record<
  CloudJobPlatform,
  { extension: string; prompt: string; rejection: string }
> = {
  android: {
    extension: "apk",
    prompt: "Choose the .apk to install",
    rejection: "The cloud installs .apk files only, not .aab bundles.",
  },
  android_physical: {
    extension: "apk",
    prompt: "Choose the .apk to install",
    rejection: "The cloud installs .apk files only, not .aab bundles.",
  },
  ios: {
    extension: "zip",
    prompt: "Choose the zipped .app simulator build",
    rejection: "iOS runs need a simulator .app bundle, zipped — an .ipa cannot be installed.",
  },
};

/** Where the chosen artefact lives for a platform. Both Android fleets share
 *  one APK; iOS keeps its own, so switching fleets never silently sends the
 *  wrong binary. */
export function cloudAppPath(platform: CloudJobPlatform): string | null {
  const ws = useWorkspaceStore.getState();
  return platform === "ios" ? ws.cloudIosAppPath : ws.cloudApkPath;
}

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
  const appPath = cloudAppPath(platform);

  if (!appPath) {
    // Thrown before anything is sent: no upload, no finalize, no run spent.
    throw new CloudJobError("NO_APK", `${CLOUD_ARTIFACTS[platform].prompt} first.`);
  }

  line(
    `[cloud] uploading ${yamlPaths.length === 1 ? "1 flow" : `${yamlPaths.length} flows`} + app…`,
  );

  const { jobId } = await submitCloudJob({ platform, appPath, yamlPaths });

  run.cloudRunStarted(jobId);
  // The run is debited when execution starts, not when the job is accepted:
  // finalize writes quotaConsumed: false and the runner flips it on claim. A
  // job that never starts costs nothing — but once started it cannot be
  // cancelled from here, and that is the part worth warning about.
  line(`[cloud] job ${jobId} queued — it will spend 1 run once it starts, and cannot be cancelled`);

  currentWatch = watchCloudJob(jobId, {
    onStatus: (status) => {
      useRunStore.getState().cloudStatusChanged(status);
      if (status === "running") line(`[cloud] running on ${CLOUD_TARGET_LABELS[platform]}`);
      else if (status === "pending") {
        line(
          platform === "android_physical"
            ? "[cloud] queued — waiting for a free phone in the farm…"
            : "[cloud] waiting for a free emulator…",
        );
      }
    },

    onFinished: ({ job, detail }) => {
      void (async () => {
        const counts = detail.summary
          ? ` — ${detail.summary.passed}/${detail.summary.total} passed`
          : "";
        // job.status, never detail.status: the run document reports the
        // runner's raw word ("success"), the job endpoint the normalised one.
        line(`[cloud] ${job.status}${counts}`);

        // An infra failure (install refused, emulator never booted) carries an
        // error and no summary. Without this the console would only say
        // "failed" for something the flow had no part in.
        if (job.error) line(`[cloud] ${job.error}`);
        if (job.reportUrl) line(`[cloud] full report: ${job.reportUrl}`);

        if (detail.logsUrl) {
          try {
            const log = await fetchArtifactText(detail.logsUrl);
            const run = useRunStore.getState();
            for (const l of log.split("\n")) {
              // Two jobs, both needed: show the line, and feed the step parser.
              // ingestLine only drives step state — on its own it downloads a
              // log and throws the text away.
              run.appendLog("stdout", l);
              run.ingestLine(l);
            }
          } catch (err) {
            line(`[cloud] the run finished but its log could not be downloaded: ${message(err)}`);
          }
        } else {
          line("[cloud] the run produced no log artifact");
        }

        // The artifact does not always carry the lines the live parser needs to
        // close a step, so nothing may be left claiming to run.
        useRunStore.getState().settleSteps();

        currentWatch = null;
        useRunStore.getState().setStopped(runVerdict(job).exitCode);
        // The balance moved when the job was accepted; refresh so the card at
        // the foot of the sidebar stops showing the pre-run figure.
        void useCloudAuthStore.getState().refreshBilling();
      })();
    },

    onError: (msg) => {
      // The run is over; only its result is unreadable. Say that, rather than
      // leaving the console sitting on "running".
      line(`[cloud] the run finished but its result could not be read: ${msg}`);
      line(`[cloud] job ${jobId} is on the dashboard if you need the detail`);
      currentWatch = null;
      useRunStore.getState().setStopped(null);
      void useCloudAuthStore.getState().refreshBilling();
    },

    onGaveUp: (id) => {
      line(`[cloud] no news for 20 minutes — no longer watching job ${id}, which may still finish`);
      currentWatch = null;
      useRunStore.getState().setStopped(null);
      void useCloudAuthStore.getState().refreshBilling();
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
