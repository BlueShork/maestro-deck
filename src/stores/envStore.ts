// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { ipc, type EnvCheckResult, type SetupDone, type SetupProgress } from "@/lib/ipc";

interface EnvState {
  checks: EnvCheckResult[];
  /** null until the first probe resolves — the popup must not flash before. */
  minimalOk: boolean | null;
  checking: boolean;
  installingId: "maestro" | "java" | null;
  lastInstallLine: string | null;
  installError: string | null;
  collapsed: boolean;
  /** True while the app is installing its own copies of the missing tools. */
  setupRunning: boolean;
  /** Human label of the tool being installed, for the toolbar chip. */
  setupTool: string | null;
  /** 0-100 while downloading; null while extracting, whose length we cannot
   *  honestly report — better no number than a frozen one. */
  setupPercent: number | null;
  setupFailures: { tool: string; label: string; error: string }[];
  /** Persisted. Only set once minimalOk was observed true. */
  dismissedForever: boolean;
  refresh: () => Promise<void>;
  install: (id: "maestro" | "java") => Promise<void>;
  onInstallOutput: (id: string, line: string) => void;
  setCollapsed: (v: boolean) => void;
  dismiss: () => void;
  /** Installs every missing managed tool. Safe to call again after a failure:
   *  tools already in place are skipped without touching the network. */
  runSetup: () => Promise<void>;
  onSetupProgress: (p: SetupProgress) => void;
  onSetupDone: (d: SetupDone) => void;
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
      setupRunning: false,
      setupTool: null,
      setupPercent: null,
      setupFailures: [],
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
      runSetup: async () => {
        if (get().setupRunning) return;
        set({ setupRunning: true, setupFailures: [] });
        try {
          await ipc.setupTools();
        } catch {
          // Per-tool failures arrive on setup:done; a throw here means the
          // command itself never ran, which the probe below will reflect.
        }
        set({ setupRunning: false, setupTool: null, setupPercent: null });
        await get().refresh();
      },
      onSetupProgress: (p) => set({ setupTool: p.label, setupPercent: p.percent }),
      onSetupDone: (d) =>
        set((s) => ({
          // A retry that succeeds must clear the old entry, or the chip would
          // stay red over a working install.
          setupFailures: d.ok
            ? s.setupFailures.filter((f) => f.tool !== d.tool)
            : [
                ...s.setupFailures.filter((f) => f.tool !== d.tool),
                { tool: d.tool, label: d.label, error: d.error ?? "install failed" },
              ],
        })),
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

/**
 * What the toolbar chip says, or null when there is nothing to say.
 *
 * It sits beside Run because that is where the frustration would otherwise
 * happen: a disabled button with no visible reason.
 */
export const selectSetupChip = (
  s: EnvState,
): { state: "installing" | "failed"; text: string } | null => {
  if (s.setupFailures.length > 0) {
    return { state: "failed", text: `Setup failed — ${s.setupFailures[0].label}` };
  }
  if (!s.setupRunning) return null;
  const percent = s.setupPercent === null ? "" : ` ${s.setupPercent}%`;
  return {
    state: "installing",
    text: s.setupTool ? `Setting up — ${s.setupTool}${percent}` : "Setting up…",
  };
};
