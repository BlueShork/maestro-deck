import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";

interface SettingsState {
  inspectKey: string;
  showFps: boolean;
  theme: ThemeMode;
  setInspectKey: (k: string) => void;
  setShowFps: (v: boolean) => void;
  setTheme: (t: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      inspectKey: "i",
      showFps: import.meta.env.DEV,
      theme: "system",
      setInspectKey: (inspectKey) => set({ inspectKey }),
      setShowFps: (showFps) => set({ showFps }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: "maestro-deck.settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        inspectKey: s.inspectKey,
        theme: s.theme,
      }),
    },
  ),
);
