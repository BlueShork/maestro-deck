// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ask } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, remove, writeTextFile } from "@tauri-apps/plugin-fs";

import { ipc } from "@/lib/ipc";
import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const DEFAULT_FLOW = `appId: com.example.app
---
- launchApp
`;

function sep(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function joinPath(dir: string, name: string): string {
  const s = sep(dir);
  return dir.endsWith(s) ? dir + name : dir + s + name;
}

function normalizeYamlName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Block path separators and shell specials to keep this scoped to the dir.
  if (/[\\/:*?"<>|]/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return trimmed;
  return `${trimmed}.yaml`;
}

export function normalizeFolderName(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Same separator/shell-special block as flows; folders keep their literal name.
  if (/[\\/:*?"<>|]/.test(trimmed)) return null;
  return trimmed;
}

async function refreshRoot(): Promise<void> {
  const ws = useWorkspaceStore.getState();
  if (!ws.folderPath) return;
  try {
    const tree = await ipc.listWorkspace(ws.folderPath);
    ws.setTree(tree);
  } catch (err) {
    toast.error("Refresh failed", err instanceof Error ? err.message : String(err));
  }
}

export async function createFlowInDir(dir: string, rawName: string): Promise<void> {
  const name = normalizeYamlName(rawName);
  if (!name) {
    toast.error("Invalid name", "Use letters, digits, dashes — no slashes.");
    return;
  }
  const full = joinPath(dir, name);
  try {
    if (await exists(full)) {
      toast.error("Already exists", name);
      return;
    }
    await writeTextFile(full, DEFAULT_FLOW);
    // Mark dir as expanded so the new file is visible after refresh.
    useWorkspaceStore.getState().setExpanded(dir, true);
    await refreshRoot();
    toast.success("Created", name);

    // Open the new file in the editor.
    const { loaded } = useFlowStore.getState();
    loaded(DEFAULT_FLOW, full);
    useWorkspaceStore.getState().setLastOpenFile(full);
  } catch (err) {
    toast.error("Create failed", err instanceof Error ? err.message : String(err));
  }
}

export async function createFolderInDir(dir: string, rawName: string): Promise<void> {
  const name = normalizeFolderName(rawName);
  if (!name) {
    toast.error("Invalid name", "Use letters, digits, dashes — no slashes.");
    return;
  }
  const full = joinPath(dir, name);
  try {
    if (await exists(full)) {
      toast.error("Already exists", name);
      return;
    }
    await mkdir(full);
    // Expand the parent and the new folder so it stays visible after refresh.
    const ws = useWorkspaceStore.getState();
    ws.setExpanded(dir, true);
    ws.setExpanded(full, true);
    await refreshRoot();
    toast.success("Created", name);
  } catch (err) {
    toast.error("Create failed", err instanceof Error ? err.message : String(err));
  }
}

export async function deleteFile(path: string): Promise<void> {
  const name = path.split(/[\\/]/).pop() ?? path;
  const ok = await ask(`Delete "${name}"? This cannot be undone.`, {
    title: "Delete flow",
    kind: "warning",
    okLabel: "Delete",
    cancelLabel: "Cancel",
  });
  if (!ok) return;
  try {
    await remove(path);

    // If the deleted file was open in the editor, clear the slate.
    const flow = useFlowStore.getState();
    if (flow.filePath === path) {
      flow.loaded("", "");
      // loaded() sets filePath; clear it explicitly to "untitled" state.
      useFlowStore.setState({ filePath: null, dirty: false });
    }
    const ws = useWorkspaceStore.getState();
    if (ws.lastOpenFile === path) ws.setLastOpenFile(null);

    await refreshRoot();
    toast.success("Deleted", name);
  } catch (err) {
    toast.error("Delete failed", err instanceof Error ? err.message : String(err));
  }
}
