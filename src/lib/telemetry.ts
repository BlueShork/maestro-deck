// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useTelemetryStore } from "@/stores/telemetryStore";

const POSTHOG_KEY = "phc_m3Hg4fMgFhkFVS5SwMYMt5966KPBfoNNZK39fE9XHjjf";
const POSTHOG_BATCH_URL = "https://eu.i.posthog.com/batch/";

export const PRIVACY_URL = "https://www.maestrodeck.cloud/legal/confidentialite";
export const COOKIES_URL = "https://www.maestrodeck.cloud/legal/cookies";

const FLUSH_DELAY_MS = 2000;
const MAX_BATCH = 20;

type DevicePlatform = "android" | "ios" | "web";

export interface TelemetryEvents {
  $screen: Record<string, never>;
  app_opened: Record<string, never>;
  device_connected: { platform: DevicePlatform; physical: boolean };
  flow_run_finished: {
    platform: DevicePlatform | "unknown";
    physical: boolean;
    scope: "flow" | "all" | "unknown";
    outcome: "passed" | "failed" | "stopped";
  };
  cloud_run_started: { platform: string; flow_count: number };
  inspector_opened: { platform: DevicePlatform | "unknown" };
  billy_message_sent: { provider: string; via_voice: boolean };
  screenshot_bank_checked: { scope: "flow" | "all" };
}

export type TelemetryEvent = keyof TelemetryEvents;

interface QueuedEvent {
  event: string;
  properties: Record<string, unknown>;
  timestamp: string;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const sessionId = crypto.randomUUID();
let currentScreen: string | null = null;

export function screenName(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "workspace" : trimmed;
}

export function setScreen(name: string): void {
  if (name === currentScreen) return;
  currentScreen = name;
  track("$screen", {});
}

function osName(): string {
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (/Mac OS X|Macintosh/i.test(ua)) return "Mac OS X";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Other";
}

function enabled(): boolean {
  return !import.meta.env.DEV && useTelemetryStore.getState().consent === "granted";
}

export function track<E extends TelemetryEvent>(event: E, properties: TelemetryEvents[E]): void {
  if (!enabled()) return;
  const installId = useTelemetryStore.getState().installId;
  if (!installId) return;
  queue.push({
    event,
    timestamp: new Date().toISOString(),
    properties: {
      ...properties,
      ...(currentScreen ? { $screen_name: currentScreen } : {}),
      distinct_id: installId,
      $session_id: sessionId,
      $process_person_profile: false,
      $lib: "maestro-deck",
      $app_version: __APP_VERSION__,
      $os: osName(),
    },
  });
  if (queue.length >= MAX_BATCH) void flush();
  else if (!flushTimer) flushTimer = setTimeout(() => void flush(), FLUSH_DELAY_MS);
}

export async function flush(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  if (!enabled()) return;
  await fetch(POSTHOG_BATCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: POSTHOG_KEY, batch }),
    keepalive: true,
  }).catch(() => undefined);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => void flush());
}
