import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { snapshotOf } from "@/test/snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ openUrl: vi.fn(), enterInspectMode: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: h.openUrl }));
vi.mock("@/lib/ipc", () => ({
  ipc: {
    onFarmSession: vi.fn(async () => () => undefined),
    enterInspectMode: h.enterInspectMode,
  },
}));
vi.mock("@/components/plugins/PluginToolbarButtons", () => ({ PluginToolbarButtons: () => null }));

import { useChatStore } from "@/stores/chatStore";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useEnvStore } from "@/stores/envStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { Toolbar } from "./Toolbar";

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

const handlers = { onRun: vi.fn(), onRunAll: vi.fn(), onStop: vi.fn() };

function renderToolbar() {
  return render(
    <MemoryRouter>
      <Toolbar {...handlers} />
      <Routes>
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const button = (name: string | RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  Object.values(handlers).forEach((f) => f.mockClear());
  h.openUrl.mockClear();
  useRunStore.setState({ running: false, starting: false, cloud: null });
  useCloudTargetStore.setState({ target: null });
  useWorkspaceStore.setState({ folderPath: "/ws", cloudApkPath: null, cloudIosAppPath: null });
  useEnvStore.setState({ minimalOk: true });
  useInspectorStore.setState({ enabled: false, loading: false });
  useChatStore.setState({ isOpen: false });
  useCloudAuthStore.setState({ user: null, billing: null });
  useUpdateStore.setState({ phase: "idle" });
  useSettingsStore.setState({ showFps: false });
  useDeviceStore.setState({ devices: [], current: null });
  useDevicePickerStore.setState({ open: false });
});
afterEach(cleanup);

describe("Toolbar run controls", () => {
  it("Run and Run all call their handlers when idle", () => {
    renderToolbar();
    fireEvent.click(button(/^Run$/));
    fireEvent.click(button(/Run all/));
    expect(handlers.onRun).toHaveBeenCalledOnce();
    expect(handlers.onRunAll).toHaveBeenCalledOnce();
  });

  it("Run all needs a workspace folder", () => {
    useWorkspaceStore.setState({ folderPath: null });
    renderToolbar();
    expect(button(/Run all/).disabled).toBe(true);
  });

  it("Run is disabled while the local tools are still missing", () => {
    useEnvStore.setState({ minimalOk: false });
    renderToolbar();
    expect(button(/^Run$/).disabled).toBe(true);
  });

  it("shows a disabled Starting… cell between the click and the pid", () => {
    useRunStore.setState({ starting: true });
    renderToolbar();
    expect(button(/Starting/).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Run$/ })).toBeNull();
  });

  it("swaps Run for Stop while running", () => {
    useRunStore.setState({ running: true });
    renderToolbar();
    fireEvent.click(button(/^Stop$/));
    expect(handlers.onStop).toHaveBeenCalledOnce();
  });

  it("a cloud run can only be stopped from watching", () => {
    useRunStore.setState({ running: true, cloud: { jobId: "j", status: "running" } });
    renderToolbar();
    expect(button(/Stop watching/)).toBeTruthy();
  });

  it("with a cloud target, Run names the cloud and needs the platform's build", () => {
    useCloudTargetStore.setState({ target: "ios" });
    useWorkspaceStore.setState({ cloudApkPath: "/app.apk", cloudIosAppPath: null });
    renderToolbar();
    expect(button(/Run in cloud/).disabled).toBe(true);
    expect(button(/Run all/).disabled).toBe(true);

    act(() => useWorkspaceStore.setState({ cloudIosAppPath: "/App.zip" }));
    expect(button(/Run in cloud/).disabled).toBe(false);
  });

  it("a cloud run does not depend on the local toolchain", () => {
    useEnvStore.setState({ minimalOk: false });
    useCloudTargetStore.setState({ target: "android" });
    useWorkspaceStore.setState({ cloudApkPath: "/app.apk" });
    renderToolbar();
    expect(button(/Run in cloud/).disabled).toBe(false);
  });
});

describe("Toolbar toggles and navigation", () => {
  it("toggles the AI assistant", () => {
    renderToolbar();
    fireEvent.click(button("Toggle AI assistant"));
    expect(useChatStore.getState().isOpen).toBe(true);
    expect(button("Toggle AI assistant").className).toContain("bg-accent");
  });

  it("toggles inspect mode, and is busy while the first dump runs", async () => {
    let release!: (v: unknown) => void;
    h.enterInspectMode.mockReturnValue(new Promise((r) => (release = r)));
    renderToolbar();
    fireEvent.click(button("Toggle inspect mode"));
    expect(button("Toggle inspect mode").getAttribute("aria-busy")).toBe("true");
    expect(button("Toggle inspect mode").disabled).toBe(true);
    await act(async () => release({ root: null, xml_raw: "" }));
    expect(button("Toggle inspect mode").getAttribute("aria-pressed")).toBe("true");
    act(() => useInspectorStore.getState().disable());
  });

  it("navigates to settings, plugins, image bank and account", () => {
    renderToolbar();
    const where = () => screen.getByTestId("where").textContent;
    fireEvent.click(button("Settings"));
    expect(where()).toBe("/settings");
    fireEvent.click(button("Open plugins"));
    expect(where()).toBe("/plugins");
    fireEvent.click(button("Open image bank"));
    expect(where()).toBe("/image-bank");
    fireEvent.click(button("Maestro Deck Cloud account"));
    expect(where()).toBe("/account");
  });

  it("opens the docs in the browser", () => {
    renderToolbar();
    fireEvent.click(button("Open documentation"));
    expect(h.openUrl).toHaveBeenCalledWith("https://www.maestrodeck.cloud/docs");
  });

  it("opens the device picker", () => {
    renderToolbar();
    fireEvent.click(button("Choose a device"));
    expect(useDevicePickerStore.getState().open).toBe(true);
  });

  it("checks for updates from the version cell, disabled while checking", () => {
    const check = vi.fn(async () => {});
    useUpdateStore.setState({ check });
    renderToolbar();
    fireEvent.click(button(/^vtest$/));
    expect(check).toHaveBeenCalledOnce();
    act(() => useUpdateStore.setState({ phase: "checking" }));
    expect(button(/checking/).disabled).toBe(true);
  });

  it("shows the stream fps only when enabled", () => {
    useStreamStore.setState({ fps: 42 });
    renderToolbar();
    expect(screen.queryByText("42 fps")).toBeNull();
    act(() => useSettingsStore.setState({ showFps: true }));
    expect(screen.getByText("42 fps")).toBeTruthy();
  });

  it("reads Free Tier when signed out and the pack name when signed in", () => {
    renderToolbar();
    expect(button("Sign in to Maestro Deck Cloud").textContent).toContain("Free Tier");
    act(() =>
      useCloudAuthStore.setState({
        user: { uid: "u", email: "a@b.c" } as never,
        billing: {
          tier: "pro",
          runsRemaining: 10,
          currentPack: { displayName: "Pro 50" },
        } as never,
      }),
    );
    expect(button("Plan: Pro 50")).toBeTruthy();
  });
});

describe("Toolbar snapshots", () => {
  it("idle, signed out", () => {
    const { container } = renderToolbar();
    expect(snapshotOf(container.querySelector("header"))).toMatchSnapshot();
  });

  it("running a cloud job", () => {
    useCloudTargetStore.setState({ target: "android" });
    useRunStore.setState({ running: true, cloud: { jobId: "j", status: "running" } });
    const { container } = renderToolbar();
    expect(snapshotOf(container.querySelector("header"))).toMatchSnapshot();
  });
});
