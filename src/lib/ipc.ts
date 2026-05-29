// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  Device,
  HealthReport,
  HierarchyTree,
  InputEvent,
  KillReport,
  MaestroAction,
  RunnerExitPayload,
  Selector,
  UINode,
  WorkspaceNode,
} from "@/types";

export class IpcError extends Error {
  constructor(
    public readonly command: string,
    cause: unknown,
  ) {
    super(`IPC ${command} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "IpcError";
  }
}

export interface MetricsSamplePayload {
  package: string;
  cpu_pct: number;
  mem_mb: number;
  fps: number | null;
  jank_pct: number | null;
  net_rx_kbps: number;
  net_tx_kbps: number;
  ts: number;
}

export interface TargetChangedPayload {
  from: string | null;
  to: string;
}

export interface MetricsStoppedPayload {
  reason: "user" | "device_disconnected" | "error";
  message: string | null;
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
  connectDevice: (serial: string, streamEnabled: boolean) =>
    call<void>("connect_device", { serial, streamEnabled }),
  disconnectDevice: () => call<void>("disconnect_device"),
  enterInspectMode: (fastMode: boolean) => call<HierarchyTree>("enter_inspect_mode", { fastMode }),
  queryElement: (x: number, y: number) => call<UINode | null>("query_element", { x, y }),
  suggestSelectors: (node: UINode) => call<Selector[]>("suggest_selectors", { node }),
  generateCommand: (action: MaestroAction) => call<string>("generate_command", { action }),
  sendInput: (event: InputEvent, screenW: number, screenH: number) =>
    call<void>("send_input", { event, screenW, screenH }),
  setDarkMode: (enabled: boolean) => call<void>("set_dark_mode", { enabled }),
  getDarkMode: () => call<boolean>("get_dark_mode"),
  runFlow: (filePath: string) => call<number>("run_flow", { filePath }),
  stopFlow: (pid: number) => call<void>("stop_flow", { pid }),
  listWorkspace: (path: string) => call<WorkspaceNode>("list_workspace", { path }),
  startStream: () => call<void>("start_stream"),
  stopStream: () => call<void>("stop_stream"),
  startMetrics: () => call<void>("start_metrics"),
  stopMetrics: () => call<void>("stop_metrics"),
  checkDeviceHealth: (serial: string) => call<HealthReport>("check_device_health", { serial }),
  killMaestroProcesses: (serial: string, report: HealthReport) =>
    call<KillReport>("kill_maestro_processes", { serial, report }),
  getToolPaths: () => call<ToolPathsView>("get_tool_paths"),
  setToolPaths: (
    adb: string | null,
    maestro: string | null,
    iproxy: string | null,
    appleTeamId: string | null,
  ) => call<ToolPathsView>("set_tool_paths", { adb, maestro, iproxy, appleTeamId }),
};

export interface ToolPathsView {
  overrides: {
    adb: string | null;
    maestro: string | null;
    iproxy: string | null;
    apple_team_id: string | null;
  };
  resolved_adb: string;
  resolved_maestro: string;
  resolved_iproxy: string;
}

export interface FrameEvent {
  ptsUs: number;
  isConfig: boolean;
  isKey: boolean;
  data: Uint8Array;
}

interface RawFrameEvent {
  ptsUs: number;
  isConfig: boolean;
  isKey: boolean;
  // Tauri serializes Vec<u8> as a JSON array of numbers; convert at the boundary.
  data: number[] | Uint8Array | ArrayBuffer;
}

function toUint8Array(d: number[] | Uint8Array | ArrayBuffer): Uint8Array {
  if (d instanceof Uint8Array) return d;
  if (d instanceof ArrayBuffer) return new Uint8Array(d);
  return Uint8Array.from(d);
}

export const events = {
  onFrame: (handler: (payload: FrameEvent) => void): Promise<UnlistenFn> =>
    listen<RawFrameEvent>("frame", (e) => {
      const p = e.payload;
      handler({
        ptsUs: p.ptsUs,
        isConfig: p.isConfig,
        isKey: p.isKey,
        data: toUint8Array(p.data),
      });
    }),
  onRunnerStdout: (handler: (line: string) => void): Promise<UnlistenFn> =>
    listen<string>("runner:stdout", (e) => handler(e.payload)),
  onRunnerStderr: (handler: (line: string) => void): Promise<UnlistenFn> =>
    listen<string>("runner:stderr", (e) => handler(e.payload)),
  onRunnerExit: (handler: (payload: RunnerExitPayload) => void): Promise<UnlistenFn> =>
    listen<RunnerExitPayload>("runner:exit", (e) => handler(e.payload)),
  onDeviceDisconnected: (handler: () => void): Promise<UnlistenFn> =>
    listen<null>("device:disconnected", () => handler()),
  onMetricsSample: (handler: (p: MetricsSamplePayload) => void): Promise<UnlistenFn> =>
    listen<MetricsSamplePayload>("metrics:sample", (e) => handler(e.payload)),
  onMetricsTargetChanged: (handler: (p: TargetChangedPayload) => void): Promise<UnlistenFn> =>
    listen<TargetChangedPayload>("metrics:target_changed", (e) => handler(e.payload)),
  onMetricsStopped: (handler: (p: MetricsStoppedPayload) => void): Promise<UnlistenFn> =>
    listen<MetricsStoppedPayload>("metrics:stopped", (e) => handler(e.payload)),
};
