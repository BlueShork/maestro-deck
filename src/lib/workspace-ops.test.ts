// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeFolderName, createFolderInDir, renameEntry, deleteEntry } from "./workspace-ops";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useFlowStore } from "@/stores/flowStore";

const { mkdir, existsFn, listWorkspace, renameFn, removeFn } = vi.hoisted(() => ({
  mkdir: vi.fn(async (_p: string) => {}),
  existsFn: vi.fn(async (_p: string) => false),
  listWorkspace: vi.fn(async () => ({ kind: "dir", name: "ws", path: "/ws", children: [] })),
  renameFn: vi.fn(async (_from: string, _to: string) => {}),
  removeFn: vi.fn(async (_p: string, _opts?: unknown) => {}),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir,
  exists: existsFn,
  writeTextFile: vi.fn(async () => {}),
  remove: removeFn,
  rename: renameFn,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ ask: vi.fn(async () => true) }));
vi.mock("@/lib/ipc", () => ({ ipc: { listWorkspace } }));

describe("normalizeFolderName", () => {
  it("accepts a plain name and trims it", () => {
    expect(normalizeFolderName("  flows  ")).toBe("flows");
  });
  it("does not append an extension", () => {
    expect(normalizeFolderName("flows.yaml")).toBe("flows.yaml");
  });
  it("rejects empty / whitespace-only names", () => {
    expect(normalizeFolderName("")).toBeNull();
    expect(normalizeFolderName("   ")).toBeNull();
  });
  it("rejects names with path separators or shell specials", () => {
    expect(normalizeFolderName("a/b")).toBeNull();
    expect(normalizeFolderName("a\\b")).toBeNull();
    expect(normalizeFolderName("a:b")).toBeNull();
    expect(normalizeFolderName("a*b")).toBeNull();
  });
  it("rejects '.' and '..' reserved names", () => {
    expect(normalizeFolderName(".")).toBeNull();
    expect(normalizeFolderName("..")).toBeNull();
  });
});

describe("createFolderInDir", () => {
  beforeEach(() => {
    mkdir.mockClear();
    existsFn.mockClear();
    existsFn.mockResolvedValue(false);
    useWorkspaceStore.setState({ folderPath: "/ws" });
  });

  it("creates the folder via mkdir with the joined path", async () => {
    await createFolderInDir("/ws", "flows");
    expect(mkdir).toHaveBeenCalledWith("/ws/flows");
  });

  it("does not create when the name is invalid", async () => {
    await createFolderInDir("/ws", "a/b");
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("does not create when a folder of that name already exists", async () => {
    existsFn.mockResolvedValue(true);
    await createFolderInDir("/ws", "flows");
    expect(mkdir).not.toHaveBeenCalled();
  });

  it("expands the parent and the new folder after creation", async () => {
    await createFolderInDir("/ws", "flows");
    const { expanded } = useWorkspaceStore.getState();
    expect(expanded["/ws"]).toBe(true);
    expect(expanded["/ws/flows"]).toBe(true);
  });
});

describe("renameEntry", () => {
  beforeEach(() => {
    renameFn.mockClear();
    existsFn.mockClear();
    existsFn.mockResolvedValue(false);
    useWorkspaceStore.setState({ folderPath: "/ws", expanded: {}, lastOpenFile: null });
    useFlowStore.setState({ filePath: null });
  });

  it("renames a file to the joined dest, normalizing the extension", async () => {
    await renameEntry("/ws/login.yaml", "file", "signup");
    expect(renameFn).toHaveBeenCalledWith("/ws/login.yaml", "/ws/signup.yaml");
  });

  it("does nothing when the name is unchanged", async () => {
    await renameEntry("/ws/login.yaml", "file", "login.yaml");
    expect(renameFn).not.toHaveBeenCalled();
  });

  it("rejects an invalid name", async () => {
    await renameEntry("/ws/login.yaml", "file", "a/b");
    expect(renameFn).not.toHaveBeenCalled();
  });

  it("does not rename when the dest already exists", async () => {
    existsFn.mockResolvedValue(true);
    await renameEntry("/ws/login.yaml", "file", "signup");
    expect(renameFn).not.toHaveBeenCalled();
  });

  it("repoints the open editor when the renamed file is open", async () => {
    useFlowStore.setState({ filePath: "/ws/login.yaml" });
    await renameEntry("/ws/login.yaml", "file", "signup");
    expect(useFlowStore.getState().filePath).toBe("/ws/signup.yaml");
  });

  it("remaps an open file and expanded keys when renaming an ancestor folder", async () => {
    useFlowStore.setState({ filePath: "/ws/old/login.yaml" });
    useWorkspaceStore.setState({
      expanded: { "/ws/old": true, "/ws/old/nested": true, "/ws/other": true },
      lastOpenFile: "/ws/old/login.yaml",
    });
    await renameEntry("/ws/old", "dir", "new");
    expect(renameFn).toHaveBeenCalledWith("/ws/old", "/ws/new");
    expect(useFlowStore.getState().filePath).toBe("/ws/new/login.yaml");
    const { expanded, lastOpenFile } = useWorkspaceStore.getState();
    expect(expanded["/ws/new"]).toBe(true);
    expect(expanded["/ws/new/nested"]).toBe(true);
    expect(expanded["/ws/other"]).toBe(true);
    expect(expanded["/ws/old"]).toBeUndefined();
    expect(lastOpenFile).toBe("/ws/new/login.yaml");
  });
});

describe("deleteEntry", () => {
  beforeEach(() => {
    removeFn.mockClear();
    useWorkspaceStore.setState({ folderPath: "/ws", lastOpenFile: null });
    useFlowStore.setState({ filePath: null });
  });

  it("deletes a file without the recursive option", async () => {
    await deleteEntry("/ws/login.yaml", "file");
    expect(removeFn).toHaveBeenCalledWith("/ws/login.yaml", undefined);
  });

  it("deletes a folder recursively", async () => {
    await deleteEntry("/ws/flows", "dir");
    expect(removeFn).toHaveBeenCalledWith("/ws/flows", { recursive: true });
  });

  it("clears the editor when the open file is inside a deleted folder", async () => {
    useFlowStore.setState({ filePath: "/ws/flows/login.yaml" });
    await deleteEntry("/ws/flows", "dir");
    expect(useFlowStore.getState().filePath).toBeNull();
  });
});
