import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface SettingsState {
  inspectKey: string;
  showFps: boolean;
  theme: ThemeMode;
  streamEnabled: boolean;
  perfMonitoringEnabled: boolean;
  setInspectKey: (k: string) => void;
  setShowFps: (v: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  setStreamEnabled: (v: boolean) => void;
  setPerfMonitoringEnabled: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      inspectKey: "i",
      showFps: import.meta.env.DEV,
      theme: "system",
      streamEnabled: true,
      perfMonitoringEnabled: false,
      setInspectKey: (inspectKey) => set({ inspectKey }),
      setShowFps: (showFps) => set({ showFps }),
      setTheme: (theme) => set({ theme }),
      setStreamEnabled: (streamEnabled) => set({ streamEnabled }),
      setPerfMonitoringEnabled: (perfMonitoringEnabled) => set({ perfMonitoringEnabled }),
    }),
    {
      name: "maestro-deck.settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        inspectKey: s.inspectKey,
        theme: s.theme,
        streamEnabled: s.streamEnabled,
        perfMonitoringEnabled: s.perfMonitoringEnabled,
      }),
    },
  ),
);
