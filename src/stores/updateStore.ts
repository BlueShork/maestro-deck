// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { create } from "zustand";

import { toast } from "@/stores/toastStore";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "ready"
  | "not-available"
  | "error";

interface UpdateState {
  phase: UpdatePhase;
  available: { version: string; notes: string | null } | null;
  /** 0..100 — only meaningful while phase === "downloading". */
  downloadPercent: number;
  /** Last error message; cleared on the next check. */
  error: string | null;

  check: (opts?: { silent?: boolean }) => Promise<void>;
  downloadAndInstall: () => Promise<void>;
  reset: () => void;
}

let pendingUpdate: Update | null = null;

export const useUpdateStore = create<UpdateState>((set, get) => ({
  phase: "idle",
  available: null,
  downloadPercent: 0,
  error: null,

  check: async ({ silent = false } = {}) => {
    if (get().phase === "checking" || get().phase === "downloading") return;
    set({ phase: "checking", error: null });
    try {
      const update = await check();
      if (!update) {
        pendingUpdate = null;
        set({ phase: "not-available", available: null });
        if (!silent) toast.success("You're up to date", "No new version available.");
        return;
      }
      pendingUpdate = update;
      set({
        phase: "available",
        available: { version: update.version, notes: update.body ?? null },
      });
    } catch (err) {
      pendingUpdate = null;
      const message = err instanceof Error ? err.message : String(err);
      // A silent (startup) check must stay invisible: a flaky network or a
      // missing/404 update endpoint should never pop the UpdateDialog or a
      // toast. Only user-initiated checks surface the failure.
      if (silent) {
        console.warn("Silent update check failed:", message);
        set({ phase: "not-available", error: null, available: null });
        return;
      }
      set({ phase: "error", error: message, available: null });
      toast.error("Update check failed", message);
    }
  },

  downloadAndInstall: async () => {
    const update = pendingUpdate;
    if (!update) return;
    set({ phase: "downloading", downloadPercent: 0, error: null });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((progress) => {
        if (progress.event === "Started") {
          total = progress.data.contentLength ?? 0;
          received = 0;
          set({ downloadPercent: 0 });
        } else if (progress.event === "Progress") {
          received += progress.data.chunkLength;
          const pct = total > 0 ? Math.min(100, (received / total) * 100) : 0;
          set({ downloadPercent: pct });
        } else if (progress.event === "Finished") {
          set({ downloadPercent: 100, phase: "installing" });
        }
      });
      set({ phase: "ready" });
      // The .downloadAndInstall call already triggered the OS installer on
      // Windows / wrote the new .app on macOS. Restart so the user lands in
      // the new version.
      await relaunch();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ phase: "error", error: message });
      toast.error("Update install failed", message);
    }
  },

  reset: () => {
    pendingUpdate = null;
    set({ phase: "idle", available: null, downloadPercent: 0, error: null });
  },
}));
