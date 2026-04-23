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
