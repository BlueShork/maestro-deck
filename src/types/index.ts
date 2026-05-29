// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type Platform = "android" | "ios";

export interface Device {
  serial: string;
  model: string;
  android_version: string;
  screen_width: number;
  screen_height: number;
  platform: Platform;
  os_version: string;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UINode {
  id: string;
  resource_id: string | null;
  text: string | null;
  content_desc: string | null;
  class_name: string;
  package: string;
  bounds: Bounds;
  clickable: boolean;
  enabled: boolean;
  focused: boolean;
  children: UINode[];
}

export interface HierarchyTree {
  root: UINode | null;
  xml_raw: string;
}

export type Selector =
  | { kind: "resourceId"; value: string }
  | { kind: "text"; value: string }
  | { kind: "contentDesc"; value: string }
  | { kind: "point"; x_pct: number; y_pct: number };

export type InputEvent =
  | { kind: "tap"; x: number; y: number }
  | {
      kind: "swipe";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      duration_ms: number;
    }
  | { kind: "text"; text: string }
  | { kind: "key"; keycode: number };

export type MaestroAction =
  | { kind: "launchApp"; app_id: string }
  | { kind: "tapOn"; selector: Selector }
  | { kind: "inputText"; text: string }
  | { kind: "assertVisible"; selector: Selector }
  | { kind: "assertNotVisible"; selector: Selector }
  | { kind: "scroll" }
  | { kind: "scrollUntilVisible"; selector: Selector }
  | { kind: "back" }
  | { kind: "hideKeyboard" }
  | { kind: "pressKey"; key: string }
  | { kind: "waitForAnimationToEnd" };

export interface RunnerExitPayload {
  code: number;
}

export type WorkspaceNode =
  | { kind: "dir"; name: string; path: string; children: WorkspaceNode[] }
  | { kind: "file"; name: string; path: string };

export interface ProcessInfo {
  pid: number;
  name: string;
}

export interface HealthReport {
  device_id: string;
  driver_running: number | null;
  port_forwarded: string | null;
  orphan_processes: ProcessInfo[];
  adb_available: boolean;
}

export interface KillReport {
  driver_killed: boolean;
  port_unforwarded: boolean;
  orphans_killed: number[];
  orphans_skipped: [number, string][];
  errors: string[];
}

export function isHealthReportClean(r: HealthReport): boolean {
  return r.driver_running === null && r.port_forwarded === null && r.orphan_processes.length === 0;
}
