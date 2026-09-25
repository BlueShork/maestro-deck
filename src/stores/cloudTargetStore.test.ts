// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCloudTargetStore } from "./cloudTargetStore";
import { useWorkspaceStore } from "./workspaceStore";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    connectDevice: vi.fn(async (serial: string) => ({ serial, platform: "android" })),
    startStream: vi.fn(),
  },
}));

beforeEach(() => {
  useCloudTargetStore.setState({ target: null });
  useWorkspaceStore.setState({ folderPath: null, cloudApkPath: null, cloudIosAppPath: null });
});

describe("cloudTargetStore", () => {
  it("starts with no cloud target, so Run stays local until asked", () => {
    expect(useCloudTargetStore.getState().target).toBeNull();
  });

  it("selects a platform and clears back to local", () => {
    useCloudTargetStore.getState().select("android");
    expect(useCloudTargetStore.getState().target).toBe("android");

    useCloudTargetStore.getState().clear();
    expect(useCloudTargetStore.getState().target).toBeNull();
  });
});

describe("handing the run target back to a local device", () => {
  it("clears the cloud target when a device is connected", async () => {
    const { useDeviceStore } = await import("./deviceStore");
    useCloudTargetStore.getState().select("android");
    useDeviceStore.setState({ devices: [{ serial: "R3CX", platform: "android" } as never] });

    await useDeviceStore.getState().connect("R3CX");

    // Otherwise both the phone and the emulator would read as chosen, and the
    // Run button's destination would be a coin toss.
    expect(useCloudTargetStore.getState().target).toBeNull();
  });
});

describe("workspace artefacts", () => {
  it("keeps the iOS build separate from the Android apk", async () => {
    const { cloudAppPath } = await import("@/lib/cloudRunner");
    useWorkspaceStore.getState().setCloudApkPath("/builds/app-debug.apk");
    useWorkspaceStore.getState().setCloudIosAppPath("/builds/MyApp.app.zip");

    // Sharing one field would send an apk to simctl, or a .app.zip to adb —
    // each failing only after the run had been charged.
    expect(cloudAppPath("android")).toBe("/builds/app-debug.apk");
    expect(cloudAppPath("android_physical")).toBe("/builds/app-debug.apk");
    expect(cloudAppPath("ios")).toBe("/builds/MyApp.app.zip");
  });

  it("forgets the iOS build when the workspace changes", () => {
    useWorkspaceStore.getState().setCloudIosAppPath("/builds/MyApp.app.zip");
    useWorkspaceStore.getState().setFolder("/other/project");
    expect(useWorkspaceStore.getState().cloudIosAppPath).toBeNull();
  });

  it("remembers the chosen apk", () => {
    useWorkspaceStore.getState().setCloudApkPath("/builds/app-debug.apk");
    expect(useWorkspaceStore.getState().cloudApkPath).toBe("/builds/app-debug.apk");
  });

  it("forgets it when the workspace changes", () => {
    useWorkspaceStore.getState().setCloudApkPath("/builds/app-debug.apk");
    useWorkspaceStore.getState().setFolder("/other/project");
    // A different project is a different app: keeping the old binary would
    // silently ship the wrong build to the emulator.
    expect(useWorkspaceStore.getState().cloudApkPath).toBeNull();
  });
});
