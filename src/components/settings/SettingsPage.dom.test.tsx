// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openUrl = vi.fn();
const openDialog = vi.fn();

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: (url: string) => openUrl(url) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => openDialog() }));

const view = {
  overrides: {
    adb: null,
    maestro: "/custom/maestro",
    iproxy: null,
    apple_team_id: null,
    maestro_ios_device: null,
  },
  resolved_adb: "/opt/homebrew/bin/adb",
  resolved_maestro: "/custom/maestro",
  resolved_iproxy: "",
  resolved_maestro_ios_device: "",
};

const ipcMock = {
  getToolPaths: vi.fn(),
  setToolPaths: vi.fn(),
  iosDeviceBridgeInstalled: vi.fn(),
  installIosDeviceBridge: vi.fn(),
  iosPhysicalSetupStatus: vi.fn(),
  environmentStatus: vi.fn(),
};

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ipc")>()),
  ipc: ipcMock,
}));

vi.mock("@/lib/chat/credentials", () => ({
  credentials: {
    getAnthropic: vi.fn().mockResolvedValue(null),
    getVertex: vi.fn().mockResolvedValue(null),
    saveAnthropic: vi.fn().mockResolvedValue(undefined),
    saveVertex: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  },
}));

const { SettingsPage } = await import("@/components/settings/SettingsPage");
const { useSettingsStore } = await import("@/stores/settingsStore");
const { useTelemetryStore } = await import("@/stores/telemetryStore");
const { useCloudAuthStore } = await import("@/stores/cloudAuthStore");
const { useChatStore } = await import("@/stores/chatStore");
const { useVisualRegressionStore } = await import("@/stores/visualRegressionStore");

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(section: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings/${section}`]}>
      <Routes>
        <Route path="/settings/:section" element={<SettingsPage />} />
        <Route path="*" element={<div>workspace</div>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  ipcMock.getToolPaths.mockResolvedValue(view);
  ipcMock.setToolPaths.mockImplementation(async (adb, maestro, iproxy, team, bridge) => ({
    ...view,
    overrides: { adb, maestro, iproxy, apple_team_id: team, maestro_ios_device: bridge },
  }));
  ipcMock.iosDeviceBridgeInstalled.mockResolvedValue(false);
  ipcMock.installIosDeviceBridge.mockResolvedValue("ok");
  ipcMock.iosPhysicalSetupStatus.mockResolvedValue({
    xcodeInstalled: true,
    maestroVersion: "2.10.0",
    maestroIs251: false,
    maestroPatched: false,
  });
  ipcMock.environmentStatus.mockResolvedValue({
    minimalOk: false,
    checks: [
      { id: "maestro", status: "ok", version: "2.10.0", detail: null },
      { id: "java", status: "missing", version: null, detail: "not on PATH" },
    ],
  });
  openDialog.mockResolvedValue("/picked/adb");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SettingsPage", () => {
  it("groups the sidebar and navigates between sections", () => {
    renderAt("general");
    expect(screen.getByText("Workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Editor & Flows/ }));
    expect(screen.getByTestId("where").textContent).toBe("/settings/editor");
  });

  it("returns to the workspace on Escape", () => {
    renderAt("general");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("redirects a legacy section id", () => {
    renderAt("billy");
    expect(screen.getByRole("heading", { name: "Billy AI" })).toBeTruthy();
  });

  it("edits the editor preferences", () => {
    renderAt("editor");
    fireEvent.change(screen.getByLabelText("Inspect shortcut key"), { target: { value: "K" } });
    fireEvent.change(screen.getByLabelText("App ID"), { target: { value: " com.acme " } });
    expect(useSettingsStore.getState().inspectKey).toBe("k");
    expect(useSettingsStore.getState().appId).toBe("com.acme");
    fireEvent.change(screen.getByLabelText("Inspect shortcut key"), { target: { value: "" } });
    expect(useSettingsStore.getState().inspectKey).toBe("i");
  });

  it("toggles telemetry and opens the policies", () => {
    useTelemetryStore.setState({ consent: "denied", installId: null });
    renderAt("privacy");
    fireEvent.click(screen.getByRole("switch", { name: "Share anonymous usage statistics" }));
    expect(useTelemetryStore.getState().consent).toBe("granted");
    const [privacy, cookies] = screen.getAllByRole("button", { name: /Open/ });
    fireEvent.click(privacy);
    fireEvent.click(cookies);
    expect(openUrl).toHaveBeenCalledWith("https://www.maestrodeck.cloud/legal/confidentialite");
    expect(openUrl).toHaveBeenCalledWith("https://www.maestrodeck.cloud/legal/cookies");
  });

  it("switches the theme from General", () => {
    renderAt("general");
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(useSettingsStore.getState().theme).toBe("dark");
  });

  it("starts the tour and the walkthrough on the workspace", () => {
    renderAt("general");
    fireEvent.click(screen.getByRole("button", { name: "Replay tour" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
    cleanup();
    renderAt("general");
    fireEvent.click(screen.getByRole("button", { name: "Start walkthrough" }));
    expect(screen.getByTestId("where").textContent).toBe("/");
  });

  it("renders the device and visual regression pages", () => {
    useVisualRegressionStore.setState({ enabled: true, tolerance: 0.2, threshold: null });
    renderAt("visual-regression");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(useVisualRegressionStore.getState().tolerance).toBeNull();
    cleanup();
    renderAt("device");
    expect(screen.getByText("experimental")).toBeTruthy();
  });

  it("shows toolchain status and saves a custom path", async () => {
    renderAt("toolchain");
    expect(await screen.findByText("not on PATH", { exact: false })).toBeTruthy();
    expect(
      await screen.findByText(/In use: \/opt\/homebrew\/bin\/adb \(auto-detected\)/),
    ).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: /Browse/ })[0]);
    await waitFor(() => expect(screen.getByDisplayValue("/picked/adb")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(ipcMock.setToolPaths).toHaveBeenCalledWith(
      "/picked/adb",
      "/custom/maestro",
      null,
      null,
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: /Re-check/ }));
    await waitFor(() => expect(ipcMock.environmentStatus).toHaveBeenCalledTimes(2));
  });

  it("reports a failed save", async () => {
    ipcMock.setToolPaths.mockRejectedValueOnce(new Error("bad path"));
    renderAt("toolchain");
    const input = await screen.findByLabelText("Maestro CLI");
    fireEvent.change(input, { target: { value: "/nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("bad path")).toBeTruthy();
  });

  it("walks the physical iPhone setup", async () => {
    renderAt("iphone");
    expect(await screen.findByText(/Found 2\.10\.0/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Apple Team ID"), { target: { value: "TEAM123" } });
    fireEvent.change(screen.getByLabelText("iproxy"), { target: { value: "/usr/bin/iproxy" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(ipcMock.setToolPaths).toHaveBeenCalledWith(
      null,
      "/custom/maestro",
      "/usr/bin/iproxy",
      "TEAM123",
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: "Install" }));
    await waitFor(() => expect(ipcMock.installIosDeviceBridge).toHaveBeenCalled());
    await waitFor(() =>
      expect(ipcMock.iosPhysicalSetupStatus.mock.calls.length).toBeGreaterThan(2),
    );
  });

  it("surfaces a failed bridge install", async () => {
    ipcMock.installIosDeviceBridge.mockRejectedValueOnce(new Error("offline"));
    renderAt("iphone");
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    expect(await screen.findByText("offline")).toBeTruthy();
  });

  it("keeps the checklist loading when the bridge probe fails", async () => {
    ipcMock.iosDeviceBridgeInstalled.mockRejectedValue(new Error("no ipc"));
    renderAt("iphone");
    await waitFor(() => expect(ipcMock.iosDeviceBridgeInstalled).toHaveBeenCalled());
    expect(screen.getByText(/Checking your setup/)).toBeTruthy();
  });

  it("shows the Billy provider and prompt", async () => {
    useCloudAuthStore.setState({ ready: true, user: null });
    useChatStore.setState({ currentProvider: "anthropic" });
    renderAt("ai");
    expect(screen.getByText("System prompt")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/API key/), { target: { value: "sk-ant-x" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    expect(await screen.findByText("Anthropic credentials saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Vertex AI" }));
    fireEvent.change(screen.getByLabelText("GCP project ID"), { target: { value: "proj" } });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "europe-west1" } });
    fireEvent.change(screen.getByLabelText(/Service account JSON/), {
      target: { value: "{}" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);
    expect(await screen.findByText("Vertex credentials saved.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Maestro Deck" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByTestId("where").textContent).toBe("/account");
  });

  it("offers hosted Billy to a signed-in user", () => {
    useCloudAuthStore.setState({ ready: true, user: { email: "me@example.com" } as never });
    useChatStore.setState({ currentProvider: "maestrodeck" });
    renderAt("ai");
    expect(screen.getByText("me@example.com")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Used by the chat" })).toBeTruthy();
  });
});
