// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ask } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, remove, rename, writeTextFile } from "@tauri-apps/plugin-fs";

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

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function dirName(path: string): string {
  const s = sep(path);
  const trimmed = path.endsWith(s) ? path.slice(0, -1) : path;
  const i = trimmed.lastIndexOf(s);
  return i <= 0 ? trimmed : trimmed.slice(0, i);
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
  if (trimmed === "." || trimmed === "..") return null;
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

/// True when `child` is the same path as `parent` or sits beneath it.
function isAtOrUnder(child: string, parent: string): boolean {
  if (child === parent) return true;
  const s = sep(parent);
  const prefix = parent.endsWith(s) ? parent : parent + s;
  return child.startsWith(prefix);
}

/// Rebuilds `child` after its ancestor `from` was renamed to `to`.
function remapUnder(child: string, from: string, to: string): string {
  if (child === from) return to;
  const s = sep(from);
  const prefix = from.endsWith(s) ? from : from + s;
  if (!child.startsWith(prefix)) return child;
  return to + s + child.slice(prefix.length);
}

/// After a rename, point editor/workspace state at the new path so an open
/// file (or anything beneath a renamed folder) keeps working.
function rewireRenamedPaths(from: string, to: string): void {
  const flow = useFlowStore.getState();
  if (flow.filePath && isAtOrUnder(flow.filePath, from)) {
    useFlowStore.setState({ filePath: remapUnder(flow.filePath, from, to) });
  }
  const ws = useWorkspaceStore.getState();
  if (ws.lastOpenFile && isAtOrUnder(ws.lastOpenFile, from)) {
    ws.setLastOpenFile(remapUnder(ws.lastOpenFile, from, to));
  }
  // Migrate expanded-folder keys (the folder itself and its descendants).
  const expanded = ws.expanded;
  let changed = false;
  const next: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(expanded)) {
    const nk = isAtOrUnder(key, from) ? remapUnder(key, from, to) : key;
    if (nk !== key) changed = true;
    next[nk] = value;
  }
  if (changed) useWorkspaceStore.setState({ expanded: next });
}

export async function renameEntry(
  path: string,
  kind: "file" | "dir",
  rawName: string,
): Promise<void> {
  const name = kind === "dir" ? normalizeFolderName(rawName) : normalizeYamlName(rawName);
  if (!name) {
    toast.error("Invalid name", "Use letters, digits, dashes — no slashes.");
    return;
  }
  if (name === baseName(path)) return; // unchanged
  const dest = joinPath(dirName(path), name);
  try {
    if (await exists(dest)) {
      toast.error("Already exists", name);
      return;
    }
    await rename(path, dest);
    rewireRenamedPaths(path, dest);
    await refreshRoot();
    toast.success("Renamed", name);
  } catch (err) {
    toast.error("Rename failed", err instanceof Error ? err.message : String(err));
  }
}

export async function deleteEntry(path: string, kind: "file" | "dir"): Promise<void> {
  const name = baseName(path);
  const ok = await ask(
    kind === "dir"
      ? `Delete folder "${name}" and all its contents? This cannot be undone.`
      : `Delete "${name}"? This cannot be undone.`,
    {
      title: kind === "dir" ? "Delete folder" : "Delete flow",
      kind: "warning",
      okLabel: "Delete",
      cancelLabel: "Cancel",
    },
  );
  if (!ok) return;
  try {
    await remove(path, kind === "dir" ? { recursive: true } : undefined);

    // If the deleted file — or any file under the deleted folder — was open in
    // the editor, clear the slate.
    const flow = useFlowStore.getState();
    if (flow.filePath && isAtOrUnder(flow.filePath, path)) {
      flow.loaded("", "");
      // loaded() sets filePath; clear it explicitly to "untitled" state.
      useFlowStore.setState({ filePath: null, dirty: false });
    }
    const ws = useWorkspaceStore.getState();
    if (ws.lastOpenFile && isAtOrUnder(ws.lastOpenFile, path)) ws.setLastOpenFile(null);

    await refreshRoot();
    toast.success("Deleted", name);
  } catch (err) {
    toast.error("Delete failed", err instanceof Error ? err.message : String(err));
  }
}

/// Back-compat thin wrapper for file deletion (hover trash button).
export async function deleteFile(path: string): Promise<void> {
  return deleteEntry(path, "file");
}
