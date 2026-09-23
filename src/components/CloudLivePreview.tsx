// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";

import LatticeLoader from "@/components/ui/LatticeLoader";
import { fetchLiveFrame, type CloudJobPlatform } from "@/lib/cloudJobs";

/** Matches the capture interval of runner.py, ios-worker/worker.py and
 *  android-physical-worker/worker.py (LiveScreen in all three). */
const LIVE_POLL_MS = 1000;

/** What the placeholder calls the device it is waiting on. */
const DEVICE_NAME: Record<CloudJobPlatform, string> = {
  android: "emulator",
  android_physical: "phone",
  ios: "simulator",
};

/** Only the emulator makes the wait long enough to warn about. */
const BOOT_HINT: Record<CloudJobPlatform, string> = {
  android: "Its screen shows here once it has booted, which takes a few minutes.",
  android_physical: "Its screen shows here in a moment.",
  ios: "Its screen shows here once it has booted.",
};

/**
 * Read-only view of a cloud run, laid over the device panel.
 *
 * The runner (Android emulator), the Mac worker (iOS) or the device-farm
 * worker (physical Android) uploads a downscaled screenshot about once a
 * second; this polls for it. An <img>, not the device canvas: the canvas belongs to the local
 * device, and its taps would land on the phone on the desk, not in the cloud.
 *
 * No frame arrives while the job is queued or while the device boots — several
 * minutes on Android, where a VM is created first — so the placeholder says
 * which of the two it is waiting on.
 */
export function CloudLivePreview({
  jobId,
  status,
  platform,
}: {
  jobId: string;
  status: string;
  platform: CloudJobPlatform;
}) {
  const device = DEVICE_NAME[platform];
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
          alt={`Cloud ${device} screen`}
          className="max-h-full max-w-full rounded-2xl border border-border object-contain"
        />
      ) : (
        <div className="flex aspect-[9/19.5] max-h-full w-auto flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background/60 p-6 text-center">
          <LatticeLoader
            // Remounted per phase so the stopwatch counts the current wait.
            key={running ? "booting" : "queued"}
            label={
              running
                ? platform === "android_physical"
                  ? "Connecting to the phone"
                  : `Starting the cloud ${device}`
                : `Waiting for a free ${device}`
            }
            grid={4}
            pattern={running ? "pulse" : "rain"}
            cellSize={8}
            gap={3}
            fontSize={13}
            className="flex-col text-foreground"
          />
          <div className="max-w-[16rem] text-xs text-muted-foreground">
            {running
              ? BOOT_HINT[platform]
              : "The job is queued. Its screen shows here once it starts."}
          </div>
        </div>
      )}
    </div>
  );
}
