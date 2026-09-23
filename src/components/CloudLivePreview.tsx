// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Cloud } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchLiveFrame } from "@/lib/cloudJobs";

/** Matches the runner's capture interval (runner.py, LiveScreen). */
const LIVE_POLL_MS = 1000;

/**
 * Read-only view of a cloud Android emulator run, laid over the device panel.
 *
 * The runner uploads a downscaled screenshot about once a second; this polls
 * for it. An <img>, not the device canvas: the canvas belongs to the local
 * device, and its taps would land on the phone on the desk, not in the cloud.
 *
 * No frame arrives while the job is queued or while the VM and emulator boot —
 * several minutes — so the placeholder says which of the two it is waiting on.
 */
export function CloudLivePreview({ jobId, status }: { jobId: string; status: string }) {
  const [frame, setFrame] = useState<string | null>(null);
  const running = status === "running";

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    let timer: number | undefined;

    // Sequential, never overlapping: a slow response delays the next request
    // instead of stacking them up.
    const tick = async () => {
      try {
        const live = await fetchLiveFrame(jobId);
        if (!cancelled && live.frame) setFrame(live.frame);
      } catch {
        // A missed frame is not worth a word: the next one will come, and the
        // console already reports anything wrong with the run itself.
      }
      if (!cancelled) timer = window.setTimeout(() => void tick(), LIVE_POLL_MS);
    };
    void tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [jobId, running]);

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-card p-4">
      {frame ? (
        <img
          src={frame}
          alt="Cloud emulator screen"
          className="max-h-full max-w-full rounded-2xl border border-border object-contain"
        />
      ) : (
        <div className="flex aspect-[9/19.5] max-h-full w-auto flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center">
          <Cloud className="h-10 w-10 animate-pulse text-muted-foreground/60" />
          <div className="text-sm font-medium">
            {running ? "Starting the cloud emulator…" : "Waiting for a free emulator…"}
          </div>
          <div className="max-w-[16rem] text-xs text-muted-foreground">
            {running
              ? "Its screen shows here once it has booted, which takes a few minutes."
              : "The job is queued. Its screen shows here once it starts."}
          </div>
        </div>
      )}
    </div>
  );
}
