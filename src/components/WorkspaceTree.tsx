// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { exists } from "@tauri-apps/plugin-fs";
import {
  ChevronRight,
  FileCode2,
  FilePlus,
  FileText,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/ContextMenu";
import { openFlowFile } from "@/lib/flow-io";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import {
  createFlowInDir,
  createFolderInDir,
  deleteEntry,
  deleteFile,
  renameEntry,
} from "@/lib/workspace-ops";
import { useFlowStore } from "@/stores/flowStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types";

export function WorkspaceTree() {
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const tree = useWorkspaceStore((s) => s.tree);
  const loading = useWorkspaceStore((s) => s.loading);
  const error = useWorkspaceStore((s) => s.error);
  const hasConfig = useWorkspaceStore((s) => s.hasConfig);
  const setFolder = useWorkspaceStore((s) => s.setFolder);
  const setTree = useWorkspaceStore((s) => s.setTree);
  const setLoading = useWorkspaceStore((s) => s.setLoading);
  const setError = useWorkspaceStore((s) => s.setError);
  const setHasConfig = useWorkspaceStore((s) => s.setHasConfig);

  // Transient: which directory currently shows the inline "new file" input.
  const [pendingNewDir, setPendingNewDir] = useState<string | null>(null);
  // Transient: which directory currently shows the inline "new folder" input.
  const [pendingNewFolderDir, setPendingNewFolderDir] = useState<string | null>(null);
  // Transient: which entry's label is currently an inline rename input.
  const [renamingPath, setRenamingPath] = useState<string | null>(null);

  const refresh = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      try {
        const t = await ipc.listWorkspace(path);
        setTree(t);
        const sep = path.includes("\\") && !path.includes("/") ? "\\" : "/";
        const configPath = path.endsWith(sep) ? `${path}config.yaml` : `${path}${sep}config.yaml`;
        try {
          setHasConfig(await exists(configPath));
        } catch {
          setHasConfig(false);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setTree(null);
        setHasConfig(false);
      } finally {
        setLoading(false);
      }
    },
    [setLoading, setError, setTree, setHasConfig],
  );

  useEffect(() => {
    if (folderPath) void refresh(folderPath);
    else setTree(null);
  }, [folderPath, refresh, setTree]);

  const onOpenFolder = useCallback(async () => {
    try {
      const picked = await openDialog({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      setFolder(picked);
    } catch (err) {
      toast.error("Open folder failed", err instanceof Error ? err.message : String(err));
    }
  }, [setFolder]);

  const onClose = useCallback(() => setFolder(null), [setFolder]);

  const startNewFile = useCallback((dirPath: string) => {
    setPendingNewFolderDir(null);
    useWorkspaceStore.getState().setExpanded(dirPath, true);
    setPendingNewDir(dirPath);
  }, []);

  const commitNewFile = useCallback(async (dir: string, name: string) => {
    setPendingNewDir(null);
    if (name.trim()) await createFlowInDir(dir, name);
  }, []);

  const cancelNewFile = useCallback(() => setPendingNewDir(null), []);

  const startNewFolder = useCallback((dirPath: string) => {
    setPendingNewDir(null);
    useWorkspaceStore.getState().setExpanded(dirPath, true);
    setPendingNewFolderDir(dirPath);
  }, []);

  const commitNewFolder = useCallback(async (dir: string, name: string) => {
    setPendingNewFolderDir(null);
    if (name.trim()) await createFolderInDir(dir, name);
  }, []);

  const cancelNewFolder = useCallback(() => setPendingNewFolderDir(null), []);

  const startRename = useCallback((path: string) => {
    setPendingNewDir(null);
    setPendingNewFolderDir(null);
    setRenamingPath(path);
  }, []);

  const commitRename = useCallback(async (path: string, kind: "file" | "dir", name: string) => {
    setRenamingPath(null);
    if (name.trim()) await renameEntry(path, kind, name);
  }, []);

  const cancelRename = useCallback(() => setRenamingPath(null), []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Workspace
        </div>
        <div className="flex items-center gap-0.5">
          {folderPath ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => startNewFolder(folderPath)}
                aria-label="New folder"
                title="New folder"
                className="h-6 w-6"
              >
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => startNewFile(folderPath)}
                aria-label="New flow"
                className="h-6 w-6"
              >
                <FilePlus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void refresh(folderPath)}
                disabled={loading}
                aria-label="Refresh workspace"
                className="h-6 w-6"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={onClose}
                aria-label="Close workspace"
                className="h-6 w-6"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <Button
              size="icon"
              variant="ghost"
              onClick={() => void onOpenFolder()}
              aria-label="Open folder"
              className="h-6 w-6"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {!folderPath ? (
        <EmptyState onOpenFolder={() => void onOpenFolder()} />
      ) : error ? (
        <div className="m-3 rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
          {error}
        </div>
      ) : tree && tree.kind === "dir" ? (
        <>
          <div
            className="flex items-center justify-between gap-2 border-b border-border px-3 py-1 font-mono text-[10px] text-muted-foreground"
            title={folderPath}
          >
            <span className="truncate">{tree.name || folderPath}</span>
            {hasConfig ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-sans text-[9px] font-medium uppercase tracking-wide text-primary"
                title="config.yaml found — Maestro will follow its flows order"
              >
                <FileText className="h-2.5 w-2.5" />
                config
              </span>
            ) : null}
          </div>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {pendingNewDir === folderPath ? (
                  <NewItemInput
                    kind="file"
                    depth={0}
                    onCommit={(name) => void commitNewFile(folderPath, name)}
                    onCancel={cancelNewFile}
                  />
                ) : null}
                {pendingNewFolderDir === folderPath ? (
                  <NewItemInput
                    kind="folder"
                    depth={0}
                    onCommit={(name) => void commitNewFolder(folderPath, name)}
                    onCancel={cancelNewFolder}
                  />
                ) : null}
                {tree.children.length === 0 &&
                pendingNewDir !== folderPath &&
                pendingNewFolderDir !== folderPath ? (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    No YAML files. Right-click or use the + icon above to create one.
                  </div>
                ) : (
                  <ul className="flex flex-col">
                    {tree.children.map((node) => (
                      <TreeItem
                        key={node.path}
                        node={node}
                        depth={0}
                        pendingNewDir={pendingNewDir}
                        onStartNewFile={startNewFile}
                        onCommitNewFile={(dir, name) => void commitNewFile(dir, name)}
                        onCancelNewFile={cancelNewFile}
                        pendingNewFolderDir={pendingNewFolderDir}
                        onStartNewFolder={startNewFolder}
                        onCommitNewFolder={(dir, name) => void commitNewFolder(dir, name)}
                        onCancelNewFolder={cancelNewFolder}
                        renamingPath={renamingPath}
                        onStartRename={startRename}
                        onCommitRename={(p, kind, name) => void commitRename(p, kind, name)}
                        onCancelRename={cancelRename}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => startNewFile(folderPath)}>
                <FilePlus className="h-3.5 w-3.5" />
                New file
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => startNewFolder(folderPath)}>
                <FolderPlus className="h-3.5 w-3.5" />
                New folder
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </>
      ) : (
        <div className="px-3 py-2 text-[11px] text-muted-foreground">Loading…</div>
      )}
    </div>
  );
}

function EmptyState({ onOpenFolder }: { onOpenFolder: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
      <FolderClosed className="h-8 w-8 text-muted-foreground" />
      <div className="text-xs text-muted-foreground">Open a folder to browse Maestro flows.</div>
      <Button size="sm" variant="outline" onClick={onOpenFolder}>
        <FolderPlus className="h-3.5 w-3.5" />
        Open folder
      </Button>
    </div>
  );
}

interface TreeItemProps {
  node: WorkspaceNode;
  depth: number;
  pendingNewDir: string | null;
  onStartNewFile: (dirPath: string) => void;
  onCommitNewFile: (dir: string, name: string) => void;
  onCancelNewFile: () => void;
  pendingNewFolderDir: string | null;
  onStartNewFolder: (dirPath: string) => void;
  onCommitNewFolder: (dir: string, name: string) => void;
  onCancelNewFolder: () => void;
  renamingPath: string | null;
  onStartRename: (path: string) => void;
  onCommitRename: (path: string, kind: "file" | "dir", name: string) => void;
  onCancelRename: () => void;
}

function TreeItem({
  node,
  depth,
  pendingNewDir,
  onStartNewFile,
  onCommitNewFile,
  onCancelNewFile,
  pendingNewFolderDir,
  onStartNewFolder,
  onCommitNewFolder,
  onCancelNewFolder,
  renamingPath,
  onStartRename,
  onCommitRename,
  onCancelRename,
}: TreeItemProps) {
  const expanded = useWorkspaceStore((s) => s.expanded[node.path] ?? depth === 0);
  const toggle = useWorkspaceStore((s) => s.toggleExpanded);
  const activePath = useFlowStore((s) => s.filePath);
  const isRenaming = renamingPath === node.path;

  if (node.kind === "dir") {
    const showNew = pendingNewDir === node.path;
    const showNewFolder = pendingNewFolderDir === node.path;
    return (
      <li>
        {isRenaming ? (
          <NewItemInput
            kind="folder"
            depth={depth}
            initial={node.name}
            onCommit={(name) => onCommitRename(node.path, "dir", name)}
            onCancel={onCancelRename}
          />
        ) : (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className="group relative flex items-center"
                style={{ paddingLeft: `${depth * 12 + 6}px` }}
                onContextMenu={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => toggle(node.path)}
                  className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left text-xs text-foreground/90 transition-colors hover:bg-accent/40"
                >
                  <ChevronRight
                    className={cn(
                      "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
                      expanded && "rotate-90",
                    )}
                  />
                  {expanded ? (
                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-300/80" />
                  ) : (
                    <FolderClosed className="h-3.5 w-3.5 shrink-0 text-amber-500/80 dark:text-amber-300/60" />
                  )}
                  <span className="truncate">{node.name}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartNewFolder(node.path);
                  }}
                  aria-label={`New folder in ${node.name}`}
                  title="New folder here"
                  className="mr-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground group-hover:flex"
                >
                  <FolderPlus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartNewFile(node.path);
                  }}
                  aria-label={`New flow in ${node.name}`}
                  title="New flow here"
                  className="mr-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground group-hover:flex"
                >
                  <FilePlus className="h-3 w-3" />
                </button>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => onStartNewFile(node.path)}>
                <FilePlus className="h-3.5 w-3.5" />
                New file
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => onStartNewFolder(node.path)}>
                <FolderPlus className="h-3.5 w-3.5" />
                New folder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onStartRename(node.path)}>
                <Pencil className="h-3.5 w-3.5" />
                Rename
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => void deleteEntry(node.path, "dir")}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )}
        {expanded && !isRenaming ? (
          <>
            {showNew ? (
              <NewItemInput
                kind="file"
                depth={depth + 1}
                onCommit={(name) => onCommitNewFile(node.path, name)}
                onCancel={onCancelNewFile}
              />
            ) : null}
            {showNewFolder ? (
              <NewItemInput
                kind="folder"
                depth={depth + 1}
                onCommit={(name) => onCommitNewFolder(node.path, name)}
                onCancel={onCancelNewFolder}
              />
            ) : null}
            {node.children.length > 0 ? (
              <ul className="flex flex-col">
                {node.children.map((c) => (
                  <TreeItem
                    key={c.path}
                    node={c}
                    depth={depth + 1}
                    pendingNewDir={pendingNewDir}
                    onStartNewFile={onStartNewFile}
                    onCommitNewFile={onCommitNewFile}
                    onCancelNewFile={onCancelNewFile}
                    pendingNewFolderDir={pendingNewFolderDir}
                    onStartNewFolder={onStartNewFolder}
                    onCommitNewFolder={onCommitNewFolder}
                    onCancelNewFolder={onCancelNewFolder}
                    renamingPath={renamingPath}
                    onStartRename={onStartRename}
                    onCommitRename={onCommitRename}
                    onCancelRename={onCancelRename}
                  />
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </li>
    );
  }

  const isActive = activePath === node.path;
  if (isRenaming) {
    return (
      <li>
        <NewItemInput
          kind="file"
          depth={depth}
          initial={node.name}
          onCommit={(name) => onCommitRename(node.path, "file", name)}
          onCancel={onCancelRename}
        />
      </li>
    );
  }
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group relative flex items-center transition-colors",
              isActive ? "bg-primary/15" : "hover:bg-accent/40",
            )}
            onContextMenu={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => void openFlowFile(node.path)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 py-0.5 text-left text-xs",
                isActive ? "text-foreground" : "text-foreground/85",
              )}
              style={{ paddingLeft: `${depth * 12 + 22}px` }}
              title={node.path}
            >
              <FileCode2
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <span className="truncate">{node.name}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                void deleteFile(node.path);
              }}
              aria-label={`Delete ${node.name}`}
              title="Delete flow"
              className="mr-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/15 hover:text-destructive group-hover:flex"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onStartRename(node.path)}>
            <Pencil className="h-3.5 w-3.5" />
            Rename
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => void deleteEntry(node.path, "file")}
            className="text-destructive focus:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

function NewItemInput({
  kind,
  depth,
  initial,
  onCommit,
  onCancel,
}: {
  kind: "file" | "folder";
  depth: number;
  /** Prefilled value for rename; when set, the base name (sans extension) is
   *  selected on mount so the user can retype immediately. */
  initial?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el || initial == null) return;
    el.focus();
    const dot = initial.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial]);

  const commit = (name: string) => {
    if (done.current) return;
    done.current = true;
    onCommit(name);
  };
  const cancel = () => {
    if (done.current) return;
    done.current = true;
    onCancel();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  };

  const Icon = kind === "folder" ? FolderClosed : FileCode2;
  const placeholder = kind === "folder" ? "folder-name" : "flow-name.yaml";

  return (
    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${depth * 12 + 22}px` }}>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={value}
        onChange={(e) => setValue(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onBlur={() => (value.trim() ? commit(value) : cancel())}
        placeholder={placeholder}
        className="my-0.5 w-full rounded border border-primary/40 bg-background px-1.5 py-0.5 text-xs outline-none focus:border-primary/70"
      />
    </div>
  );
}
