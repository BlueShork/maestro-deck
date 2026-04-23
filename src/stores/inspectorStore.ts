import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { HierarchyTree, Selector, UINode } from "@/types";

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
    try {
      const tree = await ipc.enterInspectMode();
      set({ enabled: true, tree, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false });
      toast.error("Inspect mode failed", message);
    }
  },
  disable: () => {
    set({
      enabled: false,
      tree: null,
      hovered: null,
      selected: null,
      selectors: [],
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
