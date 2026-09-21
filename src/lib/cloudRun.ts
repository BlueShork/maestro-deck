// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { fetchJobStatus, fetchRunDetail, type CloudRunDetail } from "@/lib/cloudJobs";

/** Same cadence the device list already polls at: often enough to feel live,
 *  quiet enough to leave the API alone. */
export const CLOUD_POLL_MS = 3000;

/** A job that has said nothing for this long is not coming back on its own.
 *  We stop watching and keep the id on screen rather than poll forever. */
export const CLOUD_WATCH_CEILING_MS = 20 * 60 * 1000;

/** The four raw statuses the runner and workers write
 *  (maestro-nightly/dashboard/lib/job-status.ts). Anything else is treated as
 *  still in flight. */
const TERMINAL = new Set(["passed", "failed", "error"]);

export interface CloudWatchHandlers {
  /** Fired once per distinct status, not on every poll. */
  onStatus: (status: string) => void;
  /** Fired once, with the run detail, when the job reaches a terminal status. */
  onFinished: (detail: CloudRunDetail) => void;
  /** Fired instead of onFinished when the ceiling is hit. */
  onGaveUp: (jobId: string) => void;
  /** The run ended but its result could not be read. Watching stops: the job
   *  is over, and saying nothing would leave the console frozen on "running". */
  onError: (message: string) => void;
}

export interface CloudWatch extends Promise<void> {
  /** Detach without failing the run: the job keeps going in the cloud. */
  stop: () => void;
}

/**
 * Polls a cloud job to completion.
 *
 * There is no log stream and no cancel endpoint on the server, so this is the
 * whole of what "watching a cloud run" can mean: ask for the status, report
 * each change, and fetch the run detail once it settles.
 *
 * A failed status request is not fatal — a blip on the user's network would
 * otherwise drop a run they have already paid for.
 */
export function watchCloudJob(jobId: string, handlers: CloudWatchHandlers): CloudWatch {
  let stopped = false;
  let lastStatus: string | null = null;
  const startedAt = Date.now();

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const run = (async () => {
    while (!stopped) {
      if (Date.now() - startedAt >= CLOUD_WATCH_CEILING_MS) {
        handlers.onGaveUp(jobId);
        return;
      }

      let status: string;
      try {
        ({ status } = await fetchJobStatus(jobId));
      } catch {
        // A blip while the job is still in flight is worth riding out: the next
        // tick usually succeeds, and the ceiling still applies if it doesn't.
        await sleep(CLOUD_POLL_MS);
        continue;
      }
      if (stopped) return;

      if (status !== lastStatus) {
        lastStatus = status;
        handlers.onStatus(status);
      }

      if (TERMINAL.has(status)) {
        // Past this point the run is over, so a failure is reported rather than
        // retried — retrying a finished job just hides the problem.
        try {
          const detail = await fetchRunDetail(jobId);
          if (!stopped) handlers.onFinished(detail);
        } catch (err) {
          if (!stopped) handlers.onError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      await sleep(CLOUD_POLL_MS);
    }
  })();

  const watch = run as CloudWatch;
  watch.stop = () => {
    stopped = true;
  };
  return watch;
}
