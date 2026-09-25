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
vi.mock("@/lib/ipc", () => ({
  ipc: { connectDevice: (...a: unknown[]) => connectDevice(...a) },
}));

import { useCloudTargetStore } from "./cloudTargetStore";
import { useDeviceStore } from "./deviceStore";

const PIXEL = {
  serial: "emulator-5554",
  platform: "android",
  model: "Pixel 7",
  booted: true,
  physical: false,
};

beforeEach(() => {
  connectDevice.mockReset();
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
