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
    while (frameTimes.length > 0 && now - frameTimes[0] > 1000) {
      frameTimes.shift();
    }
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
