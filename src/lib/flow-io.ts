// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export async function openFlowFile(
  path: string,
  opts: { silent?: boolean } = {},
): Promise<boolean> {
  try {
    const text = await readTextFile(path);
    useFlowStore.getState().loaded(text, path);
    useWorkspaceStore.getState().setLastOpenFile(path);
    return true;
  } catch (err) {
    if (opts.silent) {
      // The file we tried to restore is gone — forget it so we don't retry
      // on every launch.
      const ws = useWorkspaceStore.getState();
      if (ws.lastOpenFile === path) ws.setLastOpenFile(null);
    } else {
      toast.error("Open failed", err instanceof Error ? err.message : String(err));
    }
    return false;
  }
}

/** Asks for a folder and makes it the workspace. Shared by the workspace
 *  panel's button and the macOS File menu. */
export async function pickWorkspaceFolder(): Promise<void> {
  try {
    const picked = await openDialog({ directory: true, multiple: false });
    if (typeof picked !== "string") return;
    useWorkspaceStore.getState().setFolder(picked);
  } catch (err) {
    toast.error("Open folder failed", err instanceof Error ? err.message : String(err));
  }
}
