// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ipc } from "@/lib/ipc";
import { useDeviceStore } from "@/stores/deviceStore";
import type { ToolSpec } from "@/types/chat";

const KEYCODES = { back: 4, home: 3, enter: 66 } as const;

function requireDevice() {
  const device = useDeviceStore.getState().current;
  if (!device) throw new Error("No device connected — ask the user to connect one first.");
  return device;
}

export const tools = [
  {
    spec: {
      name: "tap",
      description:
        "Tap the device screen at the given coordinates in device pixels (same referential as get_screen bounds). Prefer tapping the center of an element's bounds.",
      inputSchema: {
        type: "object",
        properties: {
          x: { type: "number", description: "x in device pixels" },
          y: { type: "number", description: "y in device pixels" },
        },
        required: ["x", "y"],
      },
    } satisfies ToolSpec,
    execute: async (input: { x: number; y: number }): Promise<string> => {
      const d = requireDevice();
      await ipc.sendInput(
        { kind: "tap", x: Math.round(input.x), y: Math.round(input.y) },
        d.screen_width,
        d.screen_height,
      );
      return "ok";
    },
  },
  {
    spec: {
      name: "input_text",
      description: "Type text into the currently focused field.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    } satisfies ToolSpec,
    execute: async (input: { text: string }): Promise<string> => {
      const d = requireDevice();
      await ipc.sendInput({ kind: "text", text: input.text }, d.screen_width, d.screen_height);
      return "ok";
    },
  },
  {
    spec: {
      name: "press_key",
      description: "Press a hardware/navigation key.",
      inputSchema: {
        type: "object",
        properties: { key: { type: "string", enum: ["back", "home", "enter"] } },
        required: ["key"],
      },
    } satisfies ToolSpec,
    execute: async (input: { key: "back" | "home" | "enter" }): Promise<string> => {
      const d = requireDevice();
      if (d.platform === "ios" && input.key === "home") {
        await ipc.iosPressHome();
        return "ok";
      }
      await ipc.sendInput(
        { kind: "key", keycode: KEYCODES[input.key] },
        d.screen_width,
        d.screen_height,
      );
      return "ok";
    },
  },
];
