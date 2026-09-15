// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ipc } from "@/lib/ipc";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ToolSpec } from "@/types/chat";

function requireDevice() {
  const device = useDeviceStore.getState().current;
  if (!device) throw new Error("No device connected — ask the user to connect one first.");
  return device;
}

function resolveAppId(input: { appId?: string }): string {
  const appId = input.appId?.trim() || useSettingsStore.getState().appId?.trim();
  if (!appId) {
    throw new Error(
      "No app id given and none configured in Settings — ask the user for the app id.",
    );
  }
  return appId;
}

export const tools = [
  {
    spec: {
      name: "launch_app",
      description:
        "Launch an app on the connected device (foreground). Does NOT reset app state — to start clean, stop_app first. appId defaults to the one configured in Settings.",
      inputSchema: {
        type: "object",
        properties: { appId: { type: "string", description: "Bundle id / package name." } },
        required: [],
      },
    } satisfies ToolSpec,
    execute: async (input: { appId?: string }): Promise<string> => {
      requireDevice();
      await ipc.launchAppOnDevice(resolveAppId(input));
      return "ok";
    },
  },
  {
    spec: {
      name: "stop_app",
      description: "Force-stop an app on the connected device. appId defaults to Settings.",
      inputSchema: {
        type: "object",
        properties: { appId: { type: "string" } },
        required: [],
      },
    } satisfies ToolSpec,
    execute: async (input: { appId?: string }): Promise<string> => {
      requireDevice();
      await ipc.stopAppOnDevice(resolveAppId(input));
      return "ok";
    },
  },
];
