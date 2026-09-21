// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import type { WorkspaceNode } from "@/types";

interface WorkspaceState {
  folderPath: string | null;
  expanded: Record<string, boolean>;
  lastOpenFile: string | null;
  /** The .apk uploaded for cloud runs. Cleared when the folder changes: a
   *  different project is a different app, and silently shipping the previous
   *  build to the emulator would be worse than asking again. */
  cloudApkPath: string | null;
  /** The zipped .app simulator build uploaded for iOS cloud runs. Separate
   *  from the APK: a different artefact for a different fleet, and both can be
   *  set at once. Cleared with the folder, same reasoning. */
  cloudIosAppPath: string | null;
  // Tree is in-memory only — re-fetched on launch from folderPath.
  tree: WorkspaceNode | null;
  loading: boolean;
  error: string | null;
  hasConfig: boolean;

  setFolder: (path: string | null) => void;
  setTree: (tree: WorkspaceNode | null) => void;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  setHasConfig: (v: boolean) => void;
  toggleExpanded: (path: string) => void;
  setExpanded: (path: string, value: boolean) => void;
  setLastOpenFile: (path: string | null) => void;
  setCloudApkPath: (path: string | null) => void;
  setCloudIosAppPath: (path: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      folderPath: null,
      expanded: {},
      lastOpenFile: null,
      cloudApkPath: null,
      cloudIosAppPath: null,
      tree: null,
      loading: false,
      error: null,
      hasConfig: false,

      setFolder: (folderPath) =>
        set({
          folderPath,
          tree: null,
          error: null,
          expanded: {},
          hasConfig: false,
          cloudApkPath: null,
          cloudIosAppPath: null,
        }),
      setTree: (tree) => set({ tree }),
      setLoading: (loading) => set({ loading }),
      setError: (error) => set({ error }),
      setHasConfig: (hasConfig) => set({ hasConfig }),
      toggleExpanded: (path) =>
        set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } })),
      setExpanded: (path, value) => set((s) => ({ expanded: { ...s.expanded, [path]: value } })),
      setLastOpenFile: (lastOpenFile) => set({ lastOpenFile }),
      setCloudApkPath: (cloudApkPath) => set({ cloudApkPath }),
      setCloudIosAppPath: (cloudIosAppPath) => set({ cloudIosAppPath }),
    }),
    {
      name: "maestro-deck.workspace",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        folderPath: s.folderPath,
        expanded: s.expanded,
        lastOpenFile: s.lastOpenFile,
        cloudApkPath: s.cloudApkPath,
        cloudIosAppPath: s.cloudIosAppPath,
      }),
    },
  ),
);
