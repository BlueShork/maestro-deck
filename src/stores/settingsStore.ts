import { create } from "zustand";

interface SettingsState {
  inspectKey: string;
  showFps: boolean;
  setInspectKey: (k: string) => void;
  setShowFps: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  inspectKey: "i",
  showFps: import.meta.env.DEV,
  setInspectKey: (inspectKey) => set({ inspectKey }),
  setShowFps: (showFps) => set({ showFps }),
}));
