import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { HierarchyTree, Selector, UINode } from "@/types";

// Debounce window for auto-refresh after a tap. Long enough for the device
// UI to settle (navigation transitions are typically 250–400 ms), short
// enough to feel instant when the user swings the mouse back to inspect.
// Rapid-fire taps collapse to a single dump at the end of the burst.
const AUTO_REFRESH_DELAY_MS = 600;
// Max age before a cached tree is considered "potentially stale" when the
// user interacts with the device view again. Catches manual navigation on
// the physical phone (no tap from the app → no `scheduleAutoRefresh`).
const STALE_TREE_MS = 2000;
let autoRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let autoRefreshInFlight = false;
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
   * Mark the hierarchy as potentially stale (typically after a tap that
   * may have navigated) and schedule a debounced re-dump. No-op if inspect
   * mode isn't active. Silent on failures to avoid toast spam when the
   * device briefly disconnects or the driver is still warming up.
   */
  scheduleAutoRefresh: () => void;
  /**
   * Trigger a refresh *now* (not debounced) if the current tree is older
   * than STALE_TREE_MS and no refresh is already running. Called on user
   * interaction with the device view (hover/move) to catch manual
   * navigation on the physical phone, where no tap from the app fires.
   */
  refreshIfStale: () => void;
  setHovered: (node: UINode | null) => void;
  select: (node: UINode | null) => Promise<void>;
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
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
    // entire duration (dump can take 500–2000 ms depending on the device
    // and Maestro driver state) and is dismissed only when the backend
    // returns a result.
    const toastId = toast.loading("Dumping hierarchy…");
    try {
      const tree = await ipc.enterInspectMode();
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
      const tree = await ipc.enterInspectMode();
      treeUpdatedAt = Date.now();
      set({ tree, loading: false, hovered: null, selected: null, selectors: [] });
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
      // Guard against stacking dumps: if one is already running (previous
      // burst hasn't returned yet), let it finish — it'll reflect the
      // current screen close enough, and the next tap will reschedule.
      if (autoRefreshInFlight) return;
      if (!get().enabled) return;
      autoRefreshInFlight = true;
      set({ loading: true });
      ipc
        .enterInspectMode()
        .then((tree) => {
          // User may have exited inspect mode during the dump — drop the
          // result instead of reviving stale state.
          if (!get().enabled) return;
          treeUpdatedAt = Date.now();
          // Clear hovered/selected: they point to UINode objects from the
          // *previous* tree, whose bounds are now stale. Without this,
          // the red overlay would remain pinned to where the old node
          // was, making the refresh feel like it never happened.
          set({
            tree,
            loading: false,
            hovered: null,
            selected: null,
            selectors: [],
          });
        })
        .catch(() => {
          // Silent: don't spam toasts if the device briefly disconnects
          // or the driver is restarting. Manual Refresh button surfaces
          // errors explicitly.
          set({ loading: false });
        })
        .finally(() => {
          autoRefreshInFlight = false;
        });
    }, AUTO_REFRESH_DELAY_MS);
  },
  refreshIfStale: () => {
    if (!get().enabled) return;
    if (autoRefreshInFlight) return;
    if (autoRefreshTimer) return; // a debounced refresh is already pending
    if (treeUpdatedAt !== null && Date.now() - treeUpdatedAt < STALE_TREE_MS) {
      return;
    }
    autoRefreshInFlight = true;
    set({ loading: true });
    ipc
      .enterInspectMode()
      .then((tree) => {
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
        set({ loading: false });
      })
      .finally(() => {
        autoRefreshInFlight = false;
      });
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
}));
