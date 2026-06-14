// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import type { HierarchyTree, Selector, UINode } from "@/types";

/**
 * Read the current fast-hierarchy preference synchronously without
 * subscribing. Zustand's `getState` always returns the latest value,
 * so swapping the toggle in Settings takes effect on the next dump.
 */
const fastMode = () => useSettingsStore.getState().fastHierarchyEnabled;

// A `maestro test` run owns the iOS simulator driver exclusively; an inspect
// dump mid-run would spawn a competing `maestro studio` and deadlock both on
// :22087 (the run then never starts). Pause dumps while a run is in flight.
const runInFlight = () => {
  const s = useRunStore.getState();
  return s.running || s.starting;
};

// Debounce window for post-tap auto-refresh. Short enough that single
// taps feel responsive (dump wall-time is ~1 s anyway, 300 ms here sits
// comfortably inside the JVM warmup), long enough to coalesce rapid
// bursts into a single dump instead of two back-to-back — avoids the
// visual "spinner → done → spinner → done" double flash.
const AUTO_REFRESH_DEBOUNCE_MS = 300;
// Max age before a cached tree is considered "potentially stale" when
// the user interacts with the device view again. Catches manual
// navigation on the physical phone (no tap from the app → no
// `scheduleAutoRefresh`).
const STALE_TREE_MS = 2000;

let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let dumpInFlight = false;
let treeUpdatedAt: number | null = null;

interface InspectorState {
  enabled: boolean;
  loading: boolean;
  tree: HierarchyTree | null;
  hovered: UINode | null;
  selected: UINode | null;
  selectors: Selector[];
  toggle: () => Promise<void>;
  enable: () => Promise<void>;
  disable: () => void;
  refresh: () => Promise<void>;
  /**
   * Schedule a debounced background dump after a tap from the app.
   * Rapid-fire taps collapse to a single dump at the end of the burst.
   * No-op if inspect mode isn't active. Silent on failures to avoid
   * toast spam when the device briefly disconnects or the driver is
   * still warming up.
   */
  scheduleAutoRefresh: () => void;
  /**
   * Trigger a background dump if the current tree is older than
   * STALE_TREE_MS. Called on user interaction with the device view
   * (hover/move) to catch manual navigation on the physical phone,
   * where no tap from the app fires.
   */
  refreshIfStale: () => void;
  setHovered: (node: UINode | null) => void;
  select: (node: UINode | null) => Promise<void>;
}

export const useInspectorStore = create<InspectorState>((set, get) => {
  // Shared dump runner: skips if another dump is already in flight
  // (lets the in-flight one's result stand; the caller will retry via
  // `refreshIfStale` on hover if needed). Clears hovered/selected on
  // completion because those references pointed at UINodes of the
  // previous tree (stale bounds → overlay pinned to wrong spot).
  const runBackgroundDump = (): void => {
    if (!get().enabled) return;
    if (runInFlight()) return;
    if (dumpInFlight) return;
    dumpInFlight = true;
    set({ loading: true });
    const t0 = performance.now();
    ipc
      .enterInspectMode(fastMode())
      .then((tree) => {
        console.log(`[inspect] background dump: ${(performance.now() - t0).toFixed(0)} ms`);
        if (!get().enabled) return;
        treeUpdatedAt = Date.now();
        set({
          tree,
          loading: false,
          hovered: null,
          selected: null,
          selectors: [],
        });
      })
      .catch(() => {
        console.log(
          `[inspect] background dump failed after ${(performance.now() - t0).toFixed(0)} ms`,
        );
        // Silent (UI-wise): the manual Refresh button surfaces errors
        // explicitly; a toast on every auto-dump flake would be noise.
        set({ loading: false });
      })
      .finally(() => {
        dumpInFlight = false;
      });
  };

  return {
    enabled: false,
    loading: false,
    tree: null,
    hovered: null,
    selected: null,
    selectors: [],
    toggle: async () => {
      if (get().enabled) {
        get().disable();
      } else {
        await get().enable();
      }
    },
    enable: async () => {
      set({ loading: true });
      // Persistent snackbar while the dump runs — stays visible for the
      // entire duration (dump can take 500–2000 ms depending on the
      // device and Maestro driver state) and is dismissed only when the
      // backend returns a result.
      const toastId = toast.loading("Dumping hierarchy…");
      try {
        const tree = await ipc.enterInspectMode(fastMode());
        treeUpdatedAt = Date.now();
        set({ enabled: true, tree, loading: false });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ loading: false });
        toast.error("Inspect mode failed", message);
      } finally {
        toast.dismiss(toastId);
      }
    },
    disable: () => {
      if (autoRefreshTimer) {
        clearTimeout(autoRefreshTimer);
        autoRefreshTimer = null;
      }
      treeUpdatedAt = null;
      set({
        enabled: false,
        tree: null,
        hovered: null,
        selected: null,
        selectors: [],
      });
    },
    refresh: async () => {
      if (!get().enabled) return;
      set({ loading: true });
      try {
        const tree = await ipc.enterInspectMode(fastMode());
        treeUpdatedAt = Date.now();
        set({
          tree,
          loading: false,
          hovered: null,
          selected: null,
          selectors: [],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ loading: false });
        toast.error("Refresh failed", message);
      }
    },
    scheduleAutoRefresh: () => {
      if (!get().enabled) return;
      if (autoRefreshTimer) clearTimeout(autoRefreshTimer);
      autoRefreshTimer = setTimeout(() => {
        autoRefreshTimer = null;
        runBackgroundDump();
      }, AUTO_REFRESH_DEBOUNCE_MS);
    },
    refreshIfStale: () => {
      if (!get().enabled) return;
      if (dumpInFlight || autoRefreshTimer) return;
      if (treeUpdatedAt !== null && Date.now() - treeUpdatedAt < STALE_TREE_MS) {
        return;
      }
      runBackgroundDump();
    },
    setHovered: (node) => set({ hovered: node }),
    select: async (node) => {
      if (!node) {
        set({ selected: null, selectors: [] });
        return;
      }
      set({ selected: node, selectors: [] });
      try {
        const selectors = await ipc.suggestSelectors(node);
        set({ selectors });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast.error("Selector suggestion failed", message);
      }
    },
  };
});
