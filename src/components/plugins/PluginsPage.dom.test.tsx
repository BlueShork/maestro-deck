// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    pluginsList: vi.fn(async () => []),
    pluginsRegistry: vi.fn(async () => JSON.stringify({ plugins: [] })),
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { useSettingsStore } from "@/stores/settingsStore";
import { usePluginsStore } from "@/stores/pluginsStore";

import { PluginsPage } from "./PluginsPage";

const theme = { light: { brand: "266 85% 58%" }, dark: { brand: "267 84% 81%" } };

beforeEach(() => {
  useSettingsStore.getState().setColorTheme(null, null);
  usePluginsStore.setState({
    refreshInstalled: async () => {},
    refreshRegistry: async () => {},
    installed: [
      {
        id: "catppuccin",
        version: "1.0.0",
        dev: true,
        error: null,
        theme,
        manifest: {
          id: "catppuccin",
          name: "Catppuccin",
          version: "1.0.0",
          minAppVersion: "1.3.0",
          theme: "theme.json",
          permissions: { http: [], open: [], secrets: false },
        },
      },
    ],
  });
});

afterEach(() => {
  cleanup();
  useSettingsStore.getState().setColorTheme(null, null);
});

describe("PluginsPage themes", () => {
  it("shows a Theme badge and applies the theme", () => {
    render(
      <MemoryRouter>
        <PluginsPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Theme")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(useSettingsStore.getState().colorTheme).toBe("catppuccin");
    expect(screen.getByRole("button", { name: "Applied" })).toHaveProperty("disabled", true);
  });
});
