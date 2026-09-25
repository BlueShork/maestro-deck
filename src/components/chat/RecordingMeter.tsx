// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useEffect, useState } from "react";

import { recordingMeter } from "@/stores/billyVoiceStore";

const BAR_COUNT = 28;
/** Same cadence as the iOS app's meter: a new bar every 50 ms. */
const SAMPLE_MS = 50;

/**
 * Live feedback while Billy listens, mirroring the iOS recording bar: a red
 * dot, the input level scrolling right to left, and the elapsed time. Only
 * this component re-renders on each sample, not the chat around it.
 */
export function RecordingMeter() {
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0));
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < SAMPLE_MS) return;
      last = now;
      const meter = recordingMeter();
      if (!meter) return;
      setLevels((prev) => [...prev.slice(1), meter.level]);
      setElapsed(Math.floor(meter.elapsed));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const time = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <div
      role="status"
      aria-label={`Billy is listening, ${time}`}
      className="flex min-w-0 flex-1 items-center gap-2"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-destructive motion-safe:animate-pulse" />
      <div className="flex h-4 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
        {levels.map((level, i) => (
          <span
            key={i}
            className="w-[3px] shrink-0 rounded-full bg-foreground/70 motion-safe:transition-[height] motion-safe:duration-75"
            style={{ height: `${3 + 13 * level}px` }}
          />
        ))}
      </div>
      <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
        {time}
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground/70">
        <kbd className="rounded border border-border bg-background px-1 font-mono text-[9px]">
          Esc
        </kbd>{" "}
        to cancel
      </span>
    </div>
  );
}
