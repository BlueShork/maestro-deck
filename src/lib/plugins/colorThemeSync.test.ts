// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { syncColorTheme } from "./colorThemeSync";
import type { InstalledPlugin, PluginTheme } from "./types";

const theme: PluginTheme = { dark: { brand: "267 84% 81%" } };
const plugin = (over: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id: "catppuccin",
  version: "1.0.0",
  dev: false,
  error: null,
  manifest: {
    id: "catppuccin",
    name: "Catppuccin",
    version: "1.0.0",
    minAppVersion: "1.3.0",
    theme: "theme.json",
    permissions: { http: [], open: [], secrets: false },
  },
  theme,
  ...over,
});

describe("syncColorTheme", () => {
  it("does nothing on the default theme", () => {
    expect(syncColorTheme(null, null, [plugin()])).toBeNull();
  });

  it("does nothing when the cache is current", () => {
    expect(syncColorTheme("catppuccin", theme, [plugin()])).toBeNull();
  });

  it("refreshes the cache after an update", () => {
    const next = { dark: { brand: "1 1% 1%" } };
    expect(syncColorTheme("catppuccin", theme, [plugin({ theme: next })])).toEqual({
      id: "catppuccin",
      theme: next,
    });
  });

  it("falls back to the default when the plugin is gone or broken", () => {
    expect(syncColorTheme("catppuccin", theme, [])).toEqual({ id: null, theme: null });
    expect(
      syncColorTheme("catppuccin", theme, [plugin({ error: "bad", manifest: null, theme: null })]),
    ).toEqual({ id: null, theme: null });
  });
});
