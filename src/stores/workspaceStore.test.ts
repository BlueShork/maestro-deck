// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
  useWorkspaceStore.setState({
    folderPath: "/projects/shop",
    cloudApkPath: "/projects/shop/app.apk",
    cloudIosAppPath: "/projects/shop/Shop.zip",
  });
});

describe("cloud app paths", () => {
  it("are forgotten when another folder is opened, so the wrong app is never sent", () => {
    useWorkspaceStore.getState().setFolder("/projects/bank");

    const s = useWorkspaceStore.getState();
    expect(s.cloudApkPath).toBeNull();
    expect(s.cloudIosAppPath).toBeNull();
  });

  it("survives a restart for the same folder", () => {
    const saved = JSON.parse(localStorage.getItem("maestro-deck.workspace") ?? "{}") as {
      state: Record<string, unknown>;
    };
    expect(saved.state).toMatchObject({
      cloudApkPath: "/projects/shop/app.apk",
      cloudIosAppPath: "/projects/shop/Shop.zip",
    });
  });
});
