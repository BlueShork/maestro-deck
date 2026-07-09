// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { ipc, type EnvCheckResult } from "@/lib/ipc";

interface EnvState {
  checks: EnvCheckResult[];
  /** null until the first probe resolves — the popup must not flash before. */
  minimalOk: boolean | null;
  checking: boolean;
  installingId: "maestro" | "java" | null;
  lastInstallLine: string | null;
  installError: string | null;
  collapsed: boolean;
  /** Persisted. Only set once minimalOk was observed true. */
  dismissedForever: boolean;
  refresh: () => Promise<void>;
  install: (id: "maestro" | "java") => Promise<void>;
  onInstallOutput: (id: string, line: string) => void;
  setCollapsed: (v: boolean) => void;
  dismiss: () => void;
}

export const useEnvStore = create<EnvState>()(
  persist(
    (set, get) => ({
      checks: [],
      minimalOk: null,
      checking: false,
      installingId: null,
      lastInstallLine: null,
      installError: null,
      collapsed: false,
      dismissedForever: false,
      refresh: async () => {
        set({ checking: true });
        try {
          const s = await ipc.environmentStatus();
          set({ checks: s.checks, minimalOk: s.minimalOk, checking: false });
        } catch {
          // IPC unavailable (e.g. vite dev without tauri) — keep quiet.
          set({ checking: false });
        }
      },
      install: async (id) => {
        if (get().installingId !== null) return;
        set({ installingId: id, installError: null, lastInstallLine: null });
        try {
          await ipc.installTool(id);
          set({ installingId: null });
        } catch (err) {
          set({
            installingId: null,
            installError: err instanceof Error ? err.message : String(err),
          });
        }
        await get().refresh();
      },
      onInstallOutput: (id, line) => {
        if (get().installingId === id) set({ lastInstallLine: line });
      },
      setCollapsed: (v) => set({ collapsed: v }),
      dismiss: () => {
        // The popup is only dismissible once the minimal setup passed.
        if (get().minimalOk === true) set({ dismissedForever: true });
      },
    }),
    {
      name: "maestro-deck.env",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ dismissedForever: s.dismissedForever }),
    },
  ),
);

export const selectPopupVisible = (s: EnvState): boolean =>
  !s.dismissedForever && (s.minimalOk === false || s.installingId !== null);
