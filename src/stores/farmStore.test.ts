import { beforeEach, describe, expect, it, vi } from "vitest";

const ipcMock = vi.hoisted(() => ({
  connectFarmDevice: vi.fn(),
  farmReconnect: vi.fn(),
  farmInstallApk: vi.fn(),
  disconnectDevice: vi.fn(async () => undefined),
  onFarmSession: vi.fn(async () => () => undefined),
}));
const apiMock = vi.hoisted(() => ({
  listDevices: vi.fn(),
  open: vi.fn(),
  release: vi.fn(async () => undefined),
  reconnect: vi.fn(),
}));
vi.mock("@/lib/ipc", () => ({ ipc: ipcMock }));
vi.mock("@/lib/farmApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/farmApi")>()),
  farmApi: apiMock,
}));
vi.mock("@/stores/toastStore", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { FarmApiError } from "@/lib/farmApi";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFarmStore } from "@/stores/farmStore";
import { toast } from "@/stores/toastStore";

const PHONE = {
  id: "nuc1-S1",
  marketingName: "Galaxy S24 Ultra",
  model: "SM-S928B",
  manufacturer: "samsung",
  androidRelease: "15",
  sdk: 35,
  screen: null,
  state: "available" as const,
};
const DEVICE = {
  serial: "nuc1-S1",
  model: "SM-S928B",
  android_version: "15",
  screen_width: 1080,
  screen_height: 2340,
  platform: "android" as const,
  os_version: "15",
  booted: false,
  physical: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  useFarmStore.setState({ session: null, warnings: {}, devices: [], installing: false });
  useDeviceStore.setState({ current: null });
});

describe("farmStore", () => {
  it("connects: opens on the dashboard, connects natively, becomes the current device", async () => {
    apiMock.open.mockResolvedValue({
      sessionId: "s1",
      gatewayUrl: "wss://g",
      token: "t",
      expiresAt: 0,
    });
    ipcMock.connectFarmDevice.mockResolvedValue(DEVICE);
    await useFarmStore.getState().connect(PHONE);
    expect(ipcMock.connectFarmDevice).toHaveBeenCalledWith("wss://g", "t");
    expect(useDeviceStore.getState().current?.serial).toBe("nuc1-S1");
    expect(useFarmStore.getState().session).toMatchObject({
      sessionId: "s1",
      status: "active",
      label: "Galaxy S24 Ultra",
    });
  });

  it("a native connect failure releases the reserved session", async () => {
    apiMock.open.mockResolvedValue({
      sessionId: "s1",
      gatewayUrl: "wss://g",
      token: "t",
      expiresAt: 0,
    });
    ipcMock.connectFarmDevice.mockRejectedValue(new Error("the farm phone did not start in time"));
    await useFarmStore.getState().connect(PHONE);
    expect(apiMock.release).toHaveBeenCalledWith("s1");
    expect(useFarmStore.getState().session).toBeNull();
    expect(toast.error).toHaveBeenCalled();
  });

  it("a dashboard refusal shows its message and connects nothing", async () => {
    apiMock.open.mockRejectedValue(
      new FarmApiError("no_minutes", "You have no session minutes left."),
    );
    await useFarmStore.getState().connect(PHONE);
    expect(ipcMock.connectFarmDevice).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Can't open the farm phone",
      "You have no session minutes left.",
    );
  });

  it("the gateway closing the session clears the device with an explanation", async () => {
    useFarmStore.setState({
      session: {
        sessionId: "s1",
        deviceId: "nuc1-S1",
        label: "x",
        gatewayUrl: "wss://g",
        startedAt: 0,
        minutesRemaining: 3,
        maxEndsAt: 0,
        status: "active",
      },
    });
    useDeviceStore.setState({ current: DEVICE });
    useFarmStore.getState().handleEvent({ type: "closing", reason: "idle" });
    expect(useFarmStore.getState().session).toBeNull();
    expect(useDeviceStore.getState().current).toBeNull();
    expect(toast.info).toHaveBeenCalledWith(
      "Farm session ended",
      expect.stringMatching(/inactivity/),
    );
  });

  it("reconnecting fetches a fresh token and reconnects", async () => {
    useFarmStore.setState({
      session: {
        sessionId: "s1",
        deviceId: "nuc1-S1",
        label: "x",
        gatewayUrl: "wss://g",
        startedAt: 0,
        minutesRemaining: 3,
        maxEndsAt: 0,
        status: "active",
      },
    });
    apiMock.reconnect.mockResolvedValue({
      sessionId: "s1",
      gatewayUrl: "wss://g",
      token: "t2",
      expiresAt: 0,
    });
    ipcMock.farmReconnect.mockResolvedValue(undefined);
    useFarmStore.getState().handleEvent({ type: "reconnecting" });
    expect(useFarmStore.getState().session?.status).toBe("reconnecting");
    await vi.waitFor(() => expect(ipcMock.farmReconnect).toHaveBeenCalledWith("wss://g", "t2"));
    useFarmStore.getState().handleEvent({ type: "reconnected" });
    expect(useFarmStore.getState().session?.status).toBe("active");
  });

  it("warnings and hello update the session", () => {
    useFarmStore.setState({
      session: {
        sessionId: "s1",
        deviceId: "nuc1-S1",
        label: "x",
        gatewayUrl: "wss://g",
        startedAt: 0,
        minutesRemaining: 3,
        maxEndsAt: 0,
        status: "connecting",
      },
    });
    useFarmStore.getState().handleEvent({
      type: "hello",
      hello: {
        deviceId: "nuc1-S1",
        model: "m",
        androidRelease: "15",
        videoWidth: 1,
        videoHeight: 1,
        minutesRemaining: 42,
        maxEndsAt: 99,
      },
    });
    expect(useFarmStore.getState().session).toMatchObject({
      minutesRemaining: 42,
      maxEndsAt: 99,
      status: "active",
    });
    useFarmStore.getState().handleEvent({ type: "idle_warning", closes_at: 123 });
    expect(useFarmStore.getState().warnings).toEqual({ idle: 123 });
  });

  it("release tells the dashboard and disconnects the device", async () => {
    useFarmStore.setState({
      session: {
        sessionId: "s1",
        deviceId: "nuc1-S1",
        label: "x",
        gatewayUrl: "wss://g",
        startedAt: 0,
        minutesRemaining: 3,
        maxEndsAt: 0,
        status: "active",
      },
    });
    useDeviceStore.setState({ current: DEVICE });
    await useFarmStore.getState().release();
    expect(ipcMock.disconnectDevice).toHaveBeenCalled();
    expect(apiMock.release).toHaveBeenCalledWith("s1");
    expect(useFarmStore.getState().session).toBeNull();
  });
});

describe("farmStore after review", () => {
  const live = {
    sessionId: "s1",
    deviceId: "nuc1-S1",
    label: "x",
    gatewayUrl: "wss://g",
    startedAt: 0,
    minutesRemaining: 3,
    maxEndsAt: 0,
    status: "active" as const,
  };

  it("a gateway close also tears down the native side", () => {
    useFarmStore.setState({ session: live });
    useFarmStore.getState().handleEvent({ type: "closing", reason: "idle" });
    expect(ipcMock.disconnectDevice).toHaveBeenCalled();
  });

  it("connecting clears the previous device right away", async () => {
    useDeviceStore.setState({ current: DEVICE });
    let resolveOpen!: (v: unknown) => void;
    apiMock.open.mockReturnValue(new Promise((r) => (resolveOpen = r)));
    const pending = useFarmStore.getState().connect(PHONE);
    expect(useDeviceStore.getState().current).toBeNull();
    resolveOpen({ sessionId: "s1", gatewayUrl: "wss://g", token: "t", expiresAt: 0 });
    ipcMock.connectFarmDevice.mockResolvedValue(DEVICE);
    await pending;
  });

  it("release while the dashboard is still opening gives the phone back and connects nothing", async () => {
    let resolveOpen!: (v: unknown) => void;
    apiMock.open.mockReturnValue(new Promise((r) => (resolveOpen = r)));
    const pending = useFarmStore.getState().connect(PHONE);
    await useFarmStore.getState().release();
    resolveOpen({ sessionId: "s9", gatewayUrl: "wss://g", token: "t", expiresAt: 0 });
    await pending;
    expect(ipcMock.connectFarmDevice).not.toHaveBeenCalled();
    expect(apiMock.release).toHaveBeenCalledWith("s9");
    expect(useFarmStore.getState().session).toBeNull();
  });

  it("idle and minutes warnings are kept apart", () => {
    useFarmStore.setState({ session: live });
    useFarmStore
      .getState()
      .handleEvent({ type: "minutes_warning", closes_at: 200, reason: "no_minutes" });
    useFarmStore.getState().handleEvent({ type: "idle_warning", closes_at: 100 });
    expect(useFarmStore.getState().warnings).toEqual({ idle: 100, minutes: 200 });
  });
});
