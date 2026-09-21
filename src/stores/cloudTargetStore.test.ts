// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it } from "vitest";

import { useCloudTargetStore } from "./cloudTargetStore";
import { useWorkspaceStore } from "./workspaceStore";

beforeEach(() => {
  useCloudTargetStore.setState({ target: null });
  useWorkspaceStore.setState({ folderPath: null, cloudApkPath: null });
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

describe("workspace APK", () => {
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
