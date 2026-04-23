import { create } from "zustand";

interface StreamState {
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  hasFrame: boolean;
  pushFrame: (dims: { width: number; height: number }) => void;
  reset: () => void;
}

let frameTimes: number[] = [];

export const useStreamStore = create<StreamState>((set) => ({
  width: 0,
  height: 0,
  frameCount: 0,
  fps: 0,
  hasFrame: false,
  pushFrame: ({ width, height }) => {
    const now = performance.now();
    frameTimes.push(now);
    while (frameTimes.length > 0 && now - frameTimes[0] > 1000) {
      frameTimes.shift();
    }
    set((s) => ({
      width,
      height,
      hasFrame: true,
      frameCount: s.frameCount + 1,
      fps: frameTimes.length,
    }));
  },
  reset: () => {
    frameTimes = [];
    set({
      width: 0,
      height: 0,
      frameCount: 0,
      fps: 0,
      hasFrame: false,
    });
  },
}));
