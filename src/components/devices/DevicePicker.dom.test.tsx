import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: { onFarmSession: vi.fn(async () => () => undefined) } }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { DevicePicker } from "@/components/devices/DevicePicker";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFarmStore } from "@/stores/farmStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const phone = (id: string, state: "available" | "in_use" | "offline", name: string) => ({
  id,
  state,
  marketingName: name,
  model: name,
  manufacturer: "samsung",
  androidRelease: "15",
  sdk: 35,
  screen: null,
});

const renderPicker = () =>
  render(
    <MemoryRouter>
      <DevicePicker />
    </MemoryRouter>,
  );

afterEach(cleanup);

beforeEach(() => {
  useDevicePickerStore.setState({ open: true });
  useCloudAuthStore.setState({ user: { uid: "u", email: "a@b.c" } as never });
  useCloudTargetStore.setState({ target: null });
  useDeviceStore.setState({
    devices: [
      {
        serial: "R5C",
        model: "SM-S911B",
        android_version: "14",
        screen_width: 1080,
        screen_height: 2340,
        platform: "android",
        os_version: "14",
        booted: true,
        physical: true,
      },
    ],
    current: null,
    refresh: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
  });
  useFarmStore.setState({
    devices: [
      phone("a", "available", "Galaxy S24 Ultra"),
      phone("b", "in_use", "Pixel 8"),
      phone("c", "offline", "Moto"),
    ],
    session: null,
    refreshDevices: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
  });
});

describe("DevicePicker", () => {
  it("shows local, farm and cloud devices together", () => {
    renderPicker();
    expect(screen.getByText("SM-S911B")).toBeTruthy();
    expect(screen.getByText("Galaxy S24 Ultra")).toBeTruthy();
    expect(screen.getByText("Android emulator")).toBeTruthy();
    expect(screen.getByText("iOS Simulator")).toBeTruthy();
  });

  it("connects only farm phones that are available", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Pixel 8"));
    expect(useFarmStore.getState().connect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Galaxy S24 Ultra"));
    expect(useFarmStore.getState().connect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
    );
  });

  it("connects a local device", () => {
    renderPicker();
    fireEvent.click(screen.getByText("SM-S911B"));
    expect(useDeviceStore.getState().connect).toHaveBeenCalledWith("R5C");
  });

  it("makes a cloud fleet the run target once its build is known", async () => {
    useWorkspaceStore.setState({ cloudApkPath: "/b/app.apk" });
    renderPicker();
    fireEvent.click(screen.getByText("Android emulator"));
    await vi.waitFor(() => expect(useCloudTargetStore.getState().target).toBe("android"));
  });

  it("filters to this machine", () => {
    renderPicker();
    fireEvent.click(screen.getByRole("button", { name: /This machine/ }));
    expect(screen.queryByText("Galaxy S24 Ultra")).toBeNull();
    expect(screen.getByText("SM-S911B")).toBeTruthy();
  });

  it("pitches the cloud when signed out", () => {
    useCloudAuthStore.setState({ user: null });
    renderPicker();
    expect(screen.queryByText("Galaxy S24 Ultra")).toBeNull();
    expect(screen.getByText(/Real phones and simulators you don't own/)).toBeTruthy();
  });
});
