import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  listDevices: vi.fn(),
  connectDevice: vi.fn(),
  checkDeviceHealth: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({
  ipc: { ...h, onFarmSession: vi.fn(async () => () => undefined) },
}));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));

import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { toast } from "@/stores/toastStore";

import { DeviceSelector } from "./DeviceSelector";

const PIXEL = {
  serial: "emulator-5554",
  platform: "android",
  model: "Pixel 7",
  booted: true,
  physical: false,
  screen_width: 1080,
  screen_height: 2400,
};
const SIM = { ...PIXEL, serial: "SIM-1", platform: "ios", model: "iPhone 16" };

function mount() {
  return render(
    <MemoryRouter>
      <DeviceSelector />
    </MemoryRouter>,
  );
}

const toastSuccess = vi.spyOn(toast, "success");

beforeEach(() => {
  vi.useFakeTimers();
  h.listDevices.mockReset().mockResolvedValue([PIXEL, SIM]);
  h.connectDevice
    .mockReset()
    .mockImplementation(async (serial: string) => (serial === PIXEL.serial ? PIXEL : SIM));
  h.checkDeviceHealth.mockReset();
  toastSuccess.mockClear();
  useDeviceStore.setState({
    devices: [],
    current: null,
    connecting: false,
    pendingSerial: null,
    error: null,
    loading: false,
  });
  useCloudTargetStore.setState({ target: null });
  useDevicePickerStore.setState({ open: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const flush = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

describe("DeviceSelector", () => {
  it("lists the ready devices once loaded and invites choosing one", async () => {
    mount();
    await flush();
    expect(screen.getByText("No device yet")).toBeTruthy();
    expect(screen.getByText("Ready now")).toBeTruthy();
    expect(screen.getByText("Pixel 7")).toBeTruthy();
    expect(screen.getByText("iPhone 16")).toBeTruthy();
  });

  it("connects a ready device in one click and shows it as live", async () => {
    mount();
    await flush();
    fireEvent.click(screen.getByText("Pixel 7"));
    await flush();
    expect(h.connectDevice).toHaveBeenCalledWith("emulator-5554", true, "android", undefined);
    expect(useDeviceStore.getState().current?.serial).toBe("emulator-5554");
    expect(screen.getByText("Live")).toBeTruthy();
  });

  it("polls for hotplugged devices every 3 s while visible and idle", async () => {
    mount();
    await flush();
    expect(h.listDevices).toHaveBeenCalledTimes(1);
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(h.listDevices).toHaveBeenCalledTimes(2);

    act(() => useDeviceStore.setState({ connecting: true }));
    await act(async () => void (await vi.advanceTimersByTimeAsync(3000)));
    expect(h.listDevices).toHaveBeenCalledTimes(2);
  });

  it("does not poll while the window is hidden", async () => {
    mount();
    await flush();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await act(async () => void (await vi.advanceTimersByTimeAsync(9000)));
    expect(h.listDevices).toHaveBeenCalledTimes(1);
    hidden.mockRestore();
  });

  it("stops polling when unmounted", async () => {
    const { unmount } = mount();
    await flush();
    unmount();
    await act(async () => void (await vi.advanceTimersByTimeAsync(9000)));
    expect(h.listDevices).toHaveBeenCalledTimes(1);
  });

  it("shows a listing error", async () => {
    h.listDevices.mockRejectedValue(new Error("adb server didn't ACK"));
    mount();
    await flush();
    expect(screen.getByText("adb server didn't ACK")).toBeTruthy();
  });

  it("opens the full picker", async () => {
    mount();
    await flush();
    fireEvent.click(screen.getByText("Browse all devices"));
    expect(useDevicePickerStore.getState().open).toBe(true);
  });

  it("a clean healthcheck says so; a dirty one opens the report", async () => {
    useDeviceStore.setState({ current: PIXEL as never });
    const clean = {
      device_id: "emulator-5554",
      driver_running: null,
      port_forwarded: null,
      orphan_processes: [],
      adb_available: true,
    };
    h.checkDeviceHealth
      .mockResolvedValueOnce(clean)
      .mockResolvedValueOnce({ ...clean, driver_running: 4242, port_forwarded: "tcp:7001" });
    mount();
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Healthcheck device" }));
    await flush();
    expect(h.checkDeviceHealth).toHaveBeenCalledWith("emulator-5554");
    expect(toastSuccess).toHaveBeenCalledWith("Device clean", expect.any(String));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Healthcheck device" }));
    await flush();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getAllByText(/4242/).length).toBeGreaterThan(0);
  });
});
