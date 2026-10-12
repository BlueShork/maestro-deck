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

const connectDevice = vi.fn();
const listDevices = vi.fn();
const disconnectDevice = vi.fn();
vi.mock("@/lib/ipc", () => ({
  ipc: {
    connectDevice: (...a: unknown[]) => connectDevice(...a),
    listDevices: () => listDevices(),
    disconnectDevice: () => disconnectDevice(),
  },
}));
vi.mock("@/lib/telemetry", () => ({ track: vi.fn() }));

import { useCloudTargetStore } from "./cloudTargetStore";
import { useDeviceStore } from "./deviceStore";
import { useStreamStore } from "./streamStore";
import { useFlowStore } from "./flowStore";
import { useSettingsStore } from "./settingsStore";

const PIXEL = {
  serial: "emulator-5554",
  platform: "android",
  model: "Pixel 7",
  booted: true,
  physical: false,
};

beforeEach(() => {
  connectDevice.mockReset();
  listDevices.mockReset();
  disconnectDevice.mockReset();
  useDeviceStore.setState({ devices: [PIXEL] as never, current: null, error: null });
  useCloudTargetStore.setState({ target: "android" });
});

describe("connect", () => {
  it("takes the run target back from the cloud", async () => {
    connectDevice.mockResolvedValue(PIXEL);

    await useDeviceStore.getState().connect("emulator-5554");

    expect(useCloudTargetStore.getState().target).toBeNull();
    expect(useDeviceStore.getState().current).toEqual(PIXEL);
  });

  it("leaves the cloud target chosen when the connection fails", async () => {
    connectDevice.mockRejectedValue(new Error("device offline"));

    await useDeviceStore.getState().connect("emulator-5554");

    expect(useCloudTargetStore.getState().target).toBe("android");
    expect(useDeviceStore.getState().error).toBe("device offline");
  });
});

describe("connect while a farm phone is connected", () => {
  it("releases the farm session before connecting the local device", async () => {
    const { useFarmStore } = await import("./farmStore");
    const order: string[] = [];
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
      release: vi.fn(async () => {
        order.push("release");
        useFarmStore.setState({ session: null });
      }),
    });
    connectDevice.mockImplementation(async () => {
      order.push("connect");
      return PIXEL;
    });
    await useDeviceStore.getState().connect("emulator-5554");
    expect(order).toEqual(["release", "connect"]);
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const IPHONE = {
  serial: "SIM-1",
  platform: "ios",
  model: "iPhone 16",
  booted: true,
  physical: false,
};

describe("connect races", () => {
  it("the latest pick wins when an earlier connect resolves last", async () => {
    useDeviceStore.setState({ devices: [PIXEL, IPHONE] as never });
    const slow = deferred<unknown>();
    connectDevice.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(IPHONE);
    const first = useDeviceStore.getState().connect("emulator-5554");
    await useDeviceStore.getState().connect("SIM-1");
    slow.resolve(PIXEL);
    await first;
    expect(useDeviceStore.getState()).toMatchObject({
      current: IPHONE,
      connecting: false,
      pendingSerial: null,
    });
  });

  it("an abandoned connect's failure doesn't flag the newer connection", async () => {
    useDeviceStore.setState({ devices: [PIXEL, IPHONE] as never });
    const slow = deferred<unknown>();
    connectDevice.mockReturnValueOnce(slow.promise).mockResolvedValueOnce(IPHONE);
    const first = useDeviceStore.getState().connect("emulator-5554");
    await useDeviceStore.getState().connect("SIM-1");
    slow.reject(new Error("timed out"));
    await first;
    expect(useDeviceStore.getState()).toMatchObject({ current: IPHONE, error: null });
  });

  it("disconnecting during a connect keeps the device disconnected", async () => {
    const slow = deferred<unknown>();
    connectDevice.mockReturnValueOnce(slow.promise);
    disconnectDevice.mockResolvedValue(undefined);
    const p = useDeviceStore.getState().connect("emulator-5554");
    await useDeviceStore.getState().disconnect();
    slow.resolve(PIXEL);
    await p;
    expect(useDeviceStore.getState()).toMatchObject({ current: null, connecting: false });
  });
});

describe("connect arguments", () => {
  it("passes the stream preference and the device platform", async () => {
    useSettingsStore.setState({ streamEnabled: false });
    connectDevice.mockResolvedValue(PIXEL);
    await useDeviceStore.getState().connect("emulator-5554");
    expect(connectDevice).toHaveBeenCalledWith("emulator-5554", false, "android", undefined);
    useSettingsStore.setState({ streamEnabled: true });
  });

  it("starts a web target at the open flow's url header", async () => {
    const WEB = {
      serial: "web",
      platform: "web",
      model: "Chromium",
      booted: true,
      physical: false,
    };
    useDeviceStore.setState({ devices: [WEB] as never });
    useFlowStore.setState({ content: "url: https://example.com\n---\n- launchApp\n" });
    connectDevice.mockResolvedValue(WEB);
    await useDeviceStore.getState().connect("web");
    expect(connectDevice.mock.calls[0][2]).toBe("web");
    expect(connectDevice.mock.calls[0][3]).toBe("https://example.com");
  });

  it("keeps the device the backend actually connected (AVD → emulator serial)", async () => {
    useDeviceStore.setState({
      devices: [{ ...PIXEL, serial: "avd:Pixel_7", booted: false }] as never,
    });
    connectDevice.mockResolvedValue(PIXEL);
    await useDeviceStore.getState().connect("avd:Pixel_7");
    expect(useDeviceStore.getState().current?.serial).toBe("emulator-5554");
  });
});

describe("refresh", () => {
  it("loads the device list", async () => {
    listDevices.mockResolvedValue([PIXEL, IPHONE]);
    await useDeviceStore.getState().refresh();
    expect(useDeviceStore.getState()).toMatchObject({ devices: [PIXEL, IPHONE], loading: false });
  });

  it("a silent poll with an unchanged list does not notify", async () => {
    useDeviceStore.setState({ devices: [PIXEL, IPHONE] as never, loading: false, error: null });
    listDevices.mockResolvedValue([{ ...IPHONE }, { ...PIXEL }]);
    const listener = vi.fn();
    const unsub = useDeviceStore.subscribe(listener);
    await useDeviceStore.getState().refresh({ silent: true });
    unsub();
    expect(listener).not.toHaveBeenCalled();
  });

  it("a silent poll picks up a newly booted device", async () => {
    useDeviceStore.setState({ devices: [{ ...IPHONE, booted: false }] as never });
    listDevices.mockResolvedValue([IPHONE]);
    await useDeviceStore.getState().refresh({ silent: true });
    expect(useDeviceStore.getState().devices[0].booted).toBe(true);
  });

  it("background polls never stack while a listing is still running", async () => {
    const slow = deferred<unknown[]>();
    listDevices.mockReturnValueOnce(slow.promise).mockResolvedValue([PIXEL]);
    const first = useDeviceStore.getState().refresh({ silent: true });
    const second = useDeviceStore.getState().refresh({ silent: true });
    expect(listDevices).toHaveBeenCalledTimes(1);
    slow.resolve([PIXEL, IPHONE]);
    await Promise.all([first, second]);
    expect(useDeviceStore.getState().devices).toHaveLength(2);
    await useDeviceStore.getState().refresh({ silent: true });
    expect(listDevices).toHaveBeenCalledTimes(2);
  });

  it("a manual refresh is never skipped", async () => {
    const slow = deferred<unknown[]>();
    listDevices.mockReturnValueOnce(slow.promise).mockResolvedValue([IPHONE]);
    const poll = useDeviceStore.getState().refresh({ silent: true });
    await useDeviceStore.getState().refresh();
    expect(listDevices).toHaveBeenCalledTimes(2);
    slow.resolve([IPHONE]);
    await poll;
  });

  it("a silent poll failure keeps the last list and stays quiet", async () => {
    useDeviceStore.setState({ devices: [PIXEL] as never, error: null });
    listDevices.mockRejectedValue(new Error("adb busy"));
    await useDeviceStore.getState().refresh({ silent: true });
    expect(useDeviceStore.getState()).toMatchObject({ devices: [PIXEL], error: null });
  });

  it("a manual refresh failure clears the list and reports", async () => {
    listDevices.mockRejectedValue(new Error("adb not found"));
    await useDeviceStore.getState().refresh();
    expect(useDeviceStore.getState()).toMatchObject({
      devices: [],
      error: "adb not found",
      loading: false,
    });
  });
});

describe("disconnect", () => {
  it("clears the device and the stream even if the backend call fails", async () => {
    useDeviceStore.setState({ current: PIXEL as never });
    useStreamStore.getState().pushFrame({ width: 1080, height: 2340 });
    disconnectDevice.mockRejectedValue(new Error("already gone"));
    await useDeviceStore.getState().disconnect();
    expect(useDeviceStore.getState()).toMatchObject({
      current: null,
      pendingSerial: null,
      pendingAction: null,
    });
    expect(useStreamStore.getState().hasFrame).toBe(false);
  });

  it("markDisconnected drops the device and its stream", () => {
    useDeviceStore.setState({ current: PIXEL as never });
    useStreamStore.getState().pushFrame({ width: 1080, height: 2340 });
    useDeviceStore.getState().markDisconnected();
    expect(useDeviceStore.getState().current).toBeNull();
    expect(useStreamStore.getState().hasFrame).toBe(false);
  });
});

describe("switching platforms", () => {
  it("drops the Android frame when an iOS device takes over the canvas", async () => {
    useDeviceStore.setState({ current: PIXEL as never, devices: [PIXEL, IPHONE] as never });
    useStreamStore.getState().pushFrame({ width: 1080, height: 2400 });
    connectDevice.mockResolvedValue(IPHONE);
    await useDeviceStore.getState().connect("SIM-1");
    expect(useStreamStore.getState()).toMatchObject({ hasFrame: false, width: 0 });
  });

  it("keeps frames already painted by a newly connected Android stream", async () => {
    useDeviceStore.setState({ current: IPHONE as never, devices: [PIXEL, IPHONE] as never });
    connectDevice.mockImplementation(async () => {
      useStreamStore.getState().pushFrame({ width: 1080, height: 2400 });
      return PIXEL;
    });
    await useDeviceStore.getState().connect("emulator-5554");
    expect(useStreamStore.getState().hasFrame).toBe(true);
  });

  it("keeps the stream when reconnecting the same platform", async () => {
    useDeviceStore.setState({ current: IPHONE as never, devices: [IPHONE] as never });
    useStreamStore.getState().pushFrame({ width: 1179, height: 2556 });
    connectDevice.mockResolvedValue(IPHONE);
    await useDeviceStore.getState().connect("SIM-1");
    expect(useStreamStore.getState().hasFrame).toBe(true);
  });
});

describe("failed switch", () => {
  it("leaves nothing connected, since the previous device was already retired", async () => {
    useDeviceStore.setState({ current: PIXEL as never, devices: [PIXEL, IPHONE] as never });
    useStreamStore.getState().pushFrame({ width: 1080, height: 2400 });
    connectDevice.mockRejectedValue(new Error("simulator failed to boot"));
    await useDeviceStore.getState().connect("SIM-1");
    expect(useDeviceStore.getState()).toMatchObject({
      current: null,
      error: "simulator failed to boot",
    });
    expect(useStreamStore.getState().hasFrame).toBe(false);
  });
});
