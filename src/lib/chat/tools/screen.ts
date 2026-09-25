// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { captureDeviceFrame } from "@/lib/deviceFrame";
import { ipc } from "@/lib/ipc";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import type { ImagePart, ToolSpec } from "@/types/chat";

import { compactHierarchy } from "./compactHierarchy";

function requireDevice() {
  const device = useDeviceStore.getState().current;
  if (!device) throw new Error("No device connected — ask the user to connect one first.");
  return device;
}

export const tools = [
  {
    spec: {
      name: "get_screen",
      description:
        "Dump the current screen's view hierarchy as a compact text tree: element class, text, content-desc, resource id, bounds [x,y,w,h] in device pixels, clickable/focused/disabled flags. Use this to know what is on screen and to pick selectors. Re-read after every action that changes the screen.",
      inputSchema: { type: "object", properties: {}, required: [] },
    } satisfies ToolSpec,
    execute: async (): Promise<string> => {
      requireDevice();
      const tree = await ipc.enterInspectMode(useSettingsStore.getState().fastHierarchyEnabled);
      return compactHierarchy(tree);
    },
  },
  {
    spec: {
      name: "take_screenshot",
      description:
        "Capture the current device screen as an image. Use only when the visual appearance matters (layout, images, colors) — get_screen is cheaper and more precise for texts and selectors.",
      inputSchema: { type: "object", properties: {}, required: [] },
    } satisfies ToolSpec,
    execute: async (): Promise<ImagePart> => {
      requireDevice();
      const frame = captureDeviceFrame(800);
      if (!frame) {
        throw new Error(
          "No video frame available — the device stream is off or has not produced a frame yet.",
        );
      }
      return { kind: "image", mediaType: "image/png", base64: frame.base64 };
    },
  },
];
