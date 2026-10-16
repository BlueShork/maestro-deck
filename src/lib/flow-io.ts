// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const SAVE = "Save";
const DONT_SAVE = "Don't Save";

/** Writes the open buffer to `path` and records it as saved — unless the
 *  buffer changed during the write, in which case it stays dirty. */
export async function writeFlow(path: string): Promise<void> {
  const { content } = useFlowStore.getState();
  await writeTextFile(path, content);
  useFlowStore.getState().saved(path, content);
}

export type UnsavedOutcome =
  /** Nothing was unsaved, or autosave wrote it without asking. */
  | "clean"
  /** The user was asked and chose to save or to discard. */
  | "resolved"
  /** The user backed out (or the save failed): keep the buffer. */
  | "cancelled";

/**
 * Makes the open buffer safe to replace. Unsaved edits to a file are written
 * straight away when autosave is on; otherwise (or if that write fails, or the
 * buffer was never saved) the user picks Save / Don't Save / Cancel.
 */
export async function settleUnsavedFlow(): Promise<UnsavedOutcome> {
  const { dirty, filePath } = useFlowStore.getState();
  if (!dirty) return "clean";
  if (filePath && useSettingsStore.getState().autoSaveEnabled) {
    try {
      await writeFlow(filePath);
      return "clean";
    } catch {
      // Fall through: the user decides what happens to edits we couldn't save.
    }
  }
  const name = filePath ? filePath.split(/[\\/]/).pop() : "Untitled.yaml";
  const choice = await message(`Do you want to save the changes you made to "${name}"?`, {
    title: "Unsaved changes",
    kind: "warning",
    buttons: { yes: SAVE, no: DONT_SAVE, cancel: "Cancel" },
  });
  if (choice === DONT_SAVE || choice === "No") return "resolved";
  if (choice !== SAVE && choice !== "Yes") return "cancelled";
  try {
    const target = filePath ?? (await pickSavePath());
    if (!target) return "cancelled";
    await writeFlow(target);
    return "resolved";
  } catch (err) {
    toast.error("Save failed", err instanceof Error ? err.message : String(err));
    return "cancelled";
  }
}

async function pickSavePath(): Promise<string | null> {
  return saveDialog({ filters: [{ name: "Maestro flow", extensions: ["yaml", "yml"] }] });
}

export async function openFlowFile(
  path: string,
  opts: { silent?: boolean } = {},
): Promise<boolean> {
  if (!opts.silent) {
    const { filePath, dirty } = useFlowStore.getState();
    // Re-opening the file being edited keeps the edits rather than reloading
    // the older copy on disk over them.
    if (dirty && filePath === path) return true;
    if ((await settleUnsavedFlow()) === "cancelled") return false;
  }
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
