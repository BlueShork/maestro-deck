// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeFolderName, createFolderInDir } from "./workspace-ops";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const { mkdir, existsFn, listWorkspace } = vi.hoisted(() => ({
  mkdir: vi.fn(async (_p: string) => {}),
  existsFn: vi.fn(async (_p: string) => false),
  listWorkspace: vi.fn(async () => ({ kind: "dir", name: "ws", path: "/ws", children: [] })),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir,
  exists: existsFn,
  writeTextFile: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
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
