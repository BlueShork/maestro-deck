// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginsList: vi.fn(),
    pluginsRegistry: vi.fn(),
    pluginsInstall: vi.fn(),
    pluginsUninstall: vi.fn(),
    pluginsLoadDev: vi.fn(),
    pluginRevokeOrigin: vi.fn(),
  },
}));

import { ipc } from "@/lib/ipc";
import { storageKey } from "@/lib/plugins/bridge";
import type { InstalledPlugin, RegistryEntry } from "@/lib/plugins/types";
import { useChatStore } from "@/stores/chatStore";

import { usePluginsStore } from "./pluginsStore";

const m = vi.mocked(ipc);

const entry: RegistryEntry = {
  id: "jira",
  name: "Jira",
  description: "",
  repo: "BlueShork/maestro-deck-plugin-jira",
  version: "1.0.0",
  minAppVersion: "1.1.0",
  url: "https://x/plugin.zip",
  sha256: "a".repeat(64),
};

const installed: InstalledPlugin = {
  id: "jira",
  version: "1.0.0",
  dev: false,
  manifest: null,
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePluginsStore.setState({
    installed: [],
    registry: [],
    registryError: null,
    registryLoading: false,
    busy: {},
    openPanel: null,
  });
  useChatStore.setState({ isOpen: false });
});

describe("pluginsStore", () => {
  it("install sends the pin then refreshes the installed list", async () => {
    m.pluginsInstall.mockResolvedValue({} as never);
    m.pluginsList.mockResolvedValue([installed]);
    await usePluginsStore.getState().install(entry);
    expect(m.pluginsInstall).toHaveBeenCalledWith({
      id: "jira",
      version: "1.0.0",
      url: entry.url,
      sha256: entry.sha256,
    });
    expect(usePluginsStore.getState().installed).toEqual([installed]);
    expect(usePluginsStore.getState().busy.jira).toBeFalsy();
  });

  it("refreshRegistry failure keeps installed and records the error", async () => {
    usePluginsStore.setState({ installed: [installed] });
    m.pluginsRegistry.mockRejectedValue(new Error("IPC plugins_registry failed: network: offline"));
    await usePluginsStore.getState().refreshRegistry();
    expect(usePluginsStore.getState().installed).toEqual([installed]);
    expect(usePluginsStore.getState().registryError).toMatch(/offline/);
  });

  it("refreshRegistry parses entries", async () => {
    m.pluginsRegistry.mockResolvedValue(JSON.stringify({ schema: 1, plugins: [entry] }));
    await usePluginsStore.getState().refreshRegistry();
    expect(usePluginsStore.getState().registry).toEqual([{ ...entry, kind: "plugin" }]);
    expect(usePluginsStore.getState().registryError).toBeNull();
  });

  it("uninstall closes the open panel and clears storage", async () => {
    localStorage.setItem(storageKey("jira", "last"), "1");
    usePluginsStore.setState({ installed: [installed], openPanel: "jira" });
    m.pluginsUninstall.mockResolvedValue(undefined);
    m.pluginsList.mockResolvedValue([]);
    await usePluginsStore.getState().uninstall("jira");
    expect(usePluginsStore.getState().openPanel).toBeNull();
    expect(localStorage.getItem(storageKey("jira", "last"))).toBeNull();
  });

  it("plugin panel and Billy are mutually exclusive", () => {
    useChatStore.setState({ isOpen: true });
    usePluginsStore.getState().openPluginPanel("jira");
    expect(useChatStore.getState().isOpen).toBe(false);
    expect(usePluginsStore.getState().openPanel).toBe("jira");
    useChatStore.getState().setOpen(true);
    expect(usePluginsStore.getState().openPanel).toBeNull();
  });

  it("revokes a granted origin and refreshes the list", async () => {
    m.pluginRevokeOrigin.mockResolvedValue(undefined);
    m.pluginsList.mockResolvedValue([]);
    await usePluginsStore.getState().revokeOrigin("gitlab", "https://git.acme.fr");
    expect(m.pluginRevokeOrigin).toHaveBeenCalledWith("gitlab", "https://git.acme.fr");
    expect(m.pluginsList).toHaveBeenCalled();
  });

  it("toggle closes an open panel", () => {
    usePluginsStore.getState().togglePluginPanel("jira");
    usePluginsStore.getState().togglePluginPanel("jira");
    expect(usePluginsStore.getState().openPanel).toBeNull();
  });
});
