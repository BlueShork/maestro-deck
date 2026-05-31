// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type ThemeMode = "light" | "dark" | "system";
export type ConsoleMode = "simple" | "technical";

interface SettingsState {
  inspectKey: string;
  showFps: boolean;
  theme: ThemeMode;
  streamEnabled: boolean;
  perfMonitoringEnabled: boolean;
  /**
   * When enabled, inspect mode spawns `maestro studio` once at startup
   * (slow: 10-15s) and then fetches the hierarchy over direct gRPC on
   * each subsequent dump (<500ms). When disabled, each dump shells out
   * to the `maestro hierarchy` CLI (simple but ~11s per dump).
   *
   * Experimental flag — depends on an undocumented port contract of
   * the Maestro driver + a studio background process. Off by default
   * until we've validated output parity against the CLI path.
   */
  fastHierarchyEnabled: boolean;
  autoSaveEnabled: boolean;
  autoCheckUpdatesEnabled: boolean;
  /** Show a confirmation dialog before quitting the app. Users can opt out
   * from the dialog itself ("don't ask again") or re-enable it in Settings. */
  confirmBeforeQuit: boolean;
  consoleMode: ConsoleMode;
  setInspectKey: (k: string) => void;
  setShowFps: (v: boolean) => void;
  setTheme: (t: ThemeMode) => void;
  setStreamEnabled: (v: boolean) => void;
  setPerfMonitoringEnabled: (v: boolean) => void;
  setFastHierarchyEnabled: (v: boolean) => void;
  setAutoSaveEnabled: (v: boolean) => void;
  setAutoCheckUpdatesEnabled: (v: boolean) => void;
  setConfirmBeforeQuit: (v: boolean) => void;
  setConsoleMode: (m: ConsoleMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      inspectKey: "i",
      showFps: false,
      theme: "system",
      streamEnabled: true,
      perfMonitoringEnabled: false,
      fastHierarchyEnabled: false,
      autoSaveEnabled: true,
      autoCheckUpdatesEnabled: true,
      confirmBeforeQuit: true,
      consoleMode: "simple",
      setInspectKey: (inspectKey) => set({ inspectKey }),
      setShowFps: (showFps) => set({ showFps }),
      setTheme: (theme) => set({ theme }),
      setStreamEnabled: (streamEnabled) => set({ streamEnabled }),
      setPerfMonitoringEnabled: (perfMonitoringEnabled) => set({ perfMonitoringEnabled }),
      setFastHierarchyEnabled: (fastHierarchyEnabled) => set({ fastHierarchyEnabled }),
      setAutoSaveEnabled: (autoSaveEnabled) => set({ autoSaveEnabled }),
      setAutoCheckUpdatesEnabled: (autoCheckUpdatesEnabled) => set({ autoCheckUpdatesEnabled }),
      setConfirmBeforeQuit: (confirmBeforeQuit) => set({ confirmBeforeQuit }),
      setConsoleMode: (consoleMode) => set({ consoleMode }),
    }),
    {
      name: "maestro-deck.settings",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        inspectKey: s.inspectKey,
        theme: s.theme,
        streamEnabled: s.streamEnabled,
        perfMonitoringEnabled: s.perfMonitoringEnabled,
        fastHierarchyEnabled: s.fastHierarchyEnabled,
        autoSaveEnabled: s.autoSaveEnabled,
        autoCheckUpdatesEnabled: s.autoCheckUpdatesEnabled,
        confirmBeforeQuit: s.confirmBeforeQuit,
        consoleMode: s.consoleMode,
      }),
    },
  ),
);
