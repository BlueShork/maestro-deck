import { create } from "zustand";

interface StreamState {
  width: number;
  height: number;
  fps: number;
  hasFrame: boolean;
  pushFrame: (dims: { width: number; height: number }) => void;
  reset: () => void;
}

// fps is computed from a 1s sliding window of frame timestamps. We update the
// store at most every FPS_UPDATE_MS so UI subscribers don't re-render at the
// stream's full ~30-60 Hz, which previously caused noticeable GC churn in the
// WebContent process during long sessions.
const FPS_UPDATE_MS = 250;
let frameTimes: number[] = [];
let lastFpsUpdate = 0;

export const useStreamStore = create<StreamState>((set) => ({
  width: 0,
  height: 0,
  fps: 0,
  hasFrame: false,
  pushFrame: ({ width, height }) => {
    const now = performance.now();
    frameTimes.push(now);
    // Drop all timestamps older than 1s in one splice instead of shifting
    // in a loop (shift is O(n); splice(0, k) is O(k) amortized — same big-O
    // but one pass instead of many).
    let cutoff = 0;
    while (cutoff < frameTimes.length && now - frameTimes[cutoff] > 1000) cutoff++;
    if (cutoff > 0) frameTimes.splice(0, cutoff);
    const fpsCanUpdate = now - lastFpsUpdate >= FPS_UPDATE_MS;
    set((s) => {
      const fps = fpsCanUpdate ? frameTimes.length : s.fps;
      // Skip the state update entirely when nothing visible to subscribers
      // changed — Zustand still notifies on identical state otherwise.
      if (
        s.width === width &&
        s.height === height &&
        s.fps === fps &&
        s.hasFrame
      ) {
        return s;
      }
      if (fpsCanUpdate) lastFpsUpdate = now;
      return { width, height, hasFrame: true, fps };
    });
  },
  reset: () => {
    frameTimes = [];
    lastFpsUpdate = 0;
    set({ width: 0, height: 0, fps: 0, hasFrame: false });
  },
}));
