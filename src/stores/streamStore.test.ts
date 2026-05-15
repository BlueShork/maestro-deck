// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useStreamStore } from "./streamStore";

let now = 0;
let nowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  now = 0;
  nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
  useStreamStore.getState().reset();
});

afterEach(() => {
  nowSpy.mockRestore();
});

describe("streamStore.pushFrame", () => {
  it("sets dimensions and hasFrame on first frame", () => {
    useStreamStore.getState().pushFrame({ width: 1080, height: 1920 });
    const s = useStreamStore.getState();
    expect(s.width).toBe(1080);
    expect(s.height).toBe(1920);
    expect(s.hasFrame).toBe(true);
  });

  it("computes fps from the 1s sliding window of timestamps", () => {
    const push = useStreamStore.getState().pushFrame;
    // 4 frames at t=0, 100, 200, 300 — all within 1s window.
    // First frame (t=0) updates fps to 1 since (0 - 0) >= 250 holds.
    // Frames at 100, 200 are throttled.
    // Frame at 300 (>=250 since last update) recomputes fps from window length.
    for (const t of [0, 100, 200, 300]) {
      now = t;
      push({ width: 100, height: 100 });
    }
    expect(useStreamStore.getState().fps).toBe(4);
  });

  it("drops timestamps older than 1s from the window", () => {
    const push = useStreamStore.getState().pushFrame;
    push({ width: 1, height: 1 }); // t=0
    now = 2000;
    push({ width: 1, height: 1 }); // t=2000 — first timestamp dropped from window
    expect(useStreamStore.getState().fps).toBe(1);
  });

  it("throttles fps updates by FPS_UPDATE_MS (250ms)", () => {
    const push = useStreamStore.getState().pushFrame;
    // lastFpsUpdate starts at 0. At t=0: (0-0) < 250 → fps stays 0.
    push({ width: 1, height: 1 });
    expect(useStreamStore.getState().fps).toBe(0);

    now = 100;
    push({ width: 1, height: 1 }); // (100-0) < 250 → still throttled, fps=0
    expect(useStreamStore.getState().fps).toBe(0);

    now = 260;
    push({ width: 1, height: 1 }); // (260-0) >= 250 → fps recomputes to window size (3)
    expect(useStreamStore.getState().fps).toBe(3);

    now = 360;
    push({ width: 1, height: 1 }); // (360-260) < 250 → still throttled, fps stays 3
    expect(useStreamStore.getState().fps).toBe(3);
  });
});

describe("streamStore.reset", () => {
  it("clears dimensions, fps and frame window", () => {
    const { pushFrame, reset } = useStreamStore.getState();
    pushFrame({ width: 100, height: 100 });
    reset();
    const s = useStreamStore.getState();
    expect(s.width).toBe(0);
    expect(s.height).toBe(0);
    expect(s.fps).toBe(0);
    expect(s.hasFrame).toBe(false);
  });

  it("resets fps window state so post-reset fps starts from scratch", () => {
    const { pushFrame, reset } = useStreamStore.getState();
    for (const t of [0, 50, 100, 150, 200]) {
      now = t;
      pushFrame({ width: 1, height: 1 });
    }
    reset();
    now = 10000;
    pushFrame({ width: 1, height: 1 });
    expect(useStreamStore.getState().fps).toBe(1);
  });
});
