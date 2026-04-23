import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  Device,
  HierarchyTree,
  InputEvent,
  MaestroAction,
  RunnerExitPayload,
  Selector,
  UINode,
} from "@/types";

export class IpcError extends Error {
  constructor(
    public readonly command: string,
    cause: unknown,
  ) {
    super(
      `IPC ${command} failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "IpcError";
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args);
  } catch (err) {
    throw new IpcError(command, err);
  }
}

export const ipc = {
  ping: () => call<string>("ping"),
  appVersion: () => call<string>("app_version"),
  listDevices: () => call<Device[]>("list_devices"),
  connectDevice: (serial: string) => call<void>("connect_device", { serial }),
  disconnectDevice: () => call<void>("disconnect_device"),
  enterInspectMode: () => call<HierarchyTree>("enter_inspect_mode"),
  queryElement: (x: number, y: number) =>
    call<UINode | null>("query_element", { x, y }),
  suggestSelectors: (node: UINode) =>
    call<Selector[]>("suggest_selectors", { node }),
  generateCommand: (action: MaestroAction) =>
    call<string>("generate_command", { action }),
  sendInput: (event: InputEvent) => call<void>("send_input", { event }),
  runFlow: (filePath: string) => call<number>("run_flow", { filePath }),
  stopFlow: (pid: number) => call<void>("stop_flow", { pid }),
};

export interface FrameEvent {
  width: number;
  height: number;
  bytes: number[] | Uint8Array | ArrayBuffer;
}

export const events = {
  onFrame: (handler: (payload: FrameEvent) => void): Promise<UnlistenFn> =>
    listen<FrameEvent>("frame", (e) => handler(e.payload)),
  onRunnerStdout: (handler: (line: string) => void): Promise<UnlistenFn> =>
    listen<string>("runner:stdout", (e) => handler(e.payload)),
  onRunnerStderr: (handler: (line: string) => void): Promise<UnlistenFn> =>
    listen<string>("runner:stderr", (e) => handler(e.payload)),
  onRunnerExit: (
    handler: (payload: RunnerExitPayload) => void,
  ): Promise<UnlistenFn> =>
    listen<RunnerExitPayload>("runner:exit", (e) => handler(e.payload)),
  onDeviceDisconnected: (handler: () => void): Promise<UnlistenFn> =>
    listen<null>("device:disconnected", () => handler()),
};
