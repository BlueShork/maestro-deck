import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { WorkspaceNode } from "@/types";

interface WorkspaceState {
  folderPath: string | null;
  expanded: Record<string, boolean>;
  lastOpenFile: string | null;
  // Tree is in-memory only — re-fetched on launch from folderPath.
  tree: WorkspaceNode | null;
  loading: boolean;
  error: string | null;

  setFolder: (path: string | null) => void;
  setTree: (tree: WorkspaceNode | null) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, value: boolean) => void;
  setLastOpenFile: (path: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      folderPath: null,
      expanded: {},
      lastOpenFile: null,
      tree: null,
      loading: false,
      error: null,

      setFolder: (folderPath) =>
        set({ folderPath, tree: null, error: null, expanded: {} }),
      setTree: (tree) => set({ tree }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      toggleExpanded: (path) =>
        set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),
      setExpanded: (path, value) =>
        set((s) => ({ expanded: { ...s.expanded, [path]: value } })),
      setLastOpenFile: (lastOpenFile) => set({ lastOpenFile }),
    }),
    {
      name: "maestro-deck.workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        folderPath: s.folderPath,
        expanded: s.expanded,
        lastOpenFile: s.lastOpenFile,
      }),
    },
  ),
);
