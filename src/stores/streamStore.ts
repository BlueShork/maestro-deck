import { create } from "zustand";

interface StreamState {
  width: number;
  height: number;
  frameCount: number;
  fps: number;
  hasFrame: boolean;
  lastFrame: ImageData | null;
  pushFrame: (frame: ImageData) => void;
  reset: () => void;
}

let frameTimes: number[] = [];

export const useStreamStore = create<StreamState>((set) => ({
  width: 0,
  height: 0,
  frameCount: 0,
  fps: 0,
  hasFrame: false,
  lastFrame: null,
  pushFrame: (frame) => {
    const now = performance.now();
    frameTimes.push(now);
    while (frameTimes.length > 0 && now - frameTimes[0] > 1000) {
      frameTimes.shift();
    }
    set((s) => ({
      width: frame.width,
      height: frame.height,
      hasFrame: true,
      lastFrame: frame,
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
      lastFrame: null,
    });
  },
}));
