// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pluginsList = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ipc", () => ({ ipc: { pluginsList, pluginsRegistry: vi.fn() } }));

import { usePluginsStore } from "@/stores/pluginsStore";
import { useSettingsStore } from "@/stores/settingsStore";

import { startColorThemeSync } from "./colorThemeStartup";

const theme = { dark: { brand: "267 84% 81%" } };
let stop: (() => void) | null = null;

beforeEach(() => {
  pluginsList.mockReset();
  useSettingsStore.getState().setColorTheme("catppuccin", theme);
  usePluginsStore.setState({ installed: [], installedLoaded: false });
});

afterEach(() => {
  stop?.();
  stop = null;
  useSettingsStore.getState().setColorTheme(null, null);
});

describe("startColorThemeSync", () => {
  it("keeps the chosen theme while the installed list has not loaded", () => {
    pluginsList.mockReturnValue(new Promise(() => {}));
    stop = startColorThemeSync();
    expect(useSettingsStore.getState().colorTheme).toBe("catppuccin");
    expect(useSettingsStore.getState().colorThemeCache).toEqual(theme);
  });

  it("falls back to the default once the list loads without the plugin", async () => {
    pluginsList.mockResolvedValue([]);
    stop = startColorThemeSync();
    await vi.waitFor(() => expect(usePluginsStore.getState().installedLoaded).toBe(true));
    expect(useSettingsStore.getState().colorTheme).toBeNull();
    expect(useSettingsStore.getState().colorThemeCache).toBeNull();
  });

  it("handles a list that was already loaded before it started", () => {
    pluginsList.mockReturnValue(new Promise(() => {}));
    usePluginsStore.setState({ installed: [], installedLoaded: true });
    stop = startColorThemeSync();
    expect(useSettingsStore.getState().colorTheme).toBeNull();
  });
});
