// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { CLOUD_DASHBOARD_URL, getCloudIdToken } from "@/lib/cloudAuth";

export type FarmDeviceState = "available" | "in_use" | "offline";

export interface FarmDevice {
  id: string;
  manufacturer: string | null;
  model: string | null;
  marketingName: string | null;
  androidRelease: string | null;
  sdk: number | null;
  screen: { width: number; height: number; density: number } | null;
  state: FarmDeviceState;
}

export interface FarmOpen {
  sessionId: string;
  gatewayUrl: string;
  token: string;
  expiresAt: number;
}

const MESSAGES: Record<string, string> = {
  tier: "Device farm sessions come with a paid pack.",
  no_minutes: "You have no session minutes left. A pack adds more.",
  device_busy: "Someone just took this phone. Pick another one.",
  device_unknown: "This phone is no longer in the farm.",
  session_exists: "You already have a farm session open.",
  rate_limited: "Too many attempts. Wait a minute and try again.",
  FARM_DISABLED: "The device farm is not available right now.",
  not_active: "This session has ended.",
  not_found: "This session no longer exists.",
  internal: "The device farm had a problem. Try again in a moment.",
};

const CLOSE_REASONS: Record<string, string> = {
  user: "Session ended.",
  idle: "Session closed after 5 minutes of inactivity.",
  max_duration: "Session reached its 60-minute limit.",
  no_minutes: "You ran out of session minutes.",
  disconnected: "The connection was lost and the session closed.",
  agent_lost: "The farm phone stopped responding. You were billed up to that point.",
  device_lost: "The farm phone stopped responding. You were billed up to that point.",
  agent_error: "The farm phone could not be prepared. Nothing was billed.",
  gateway_restart: "The device farm restarted. You were billed up to the last minute.",
};

export class FarmApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly sessionId?: string,
  ) {
    super(message);
    this.name = "FarmApiError";
  }
}

export function closeReasonMessage(reason: string): string {
  return CLOSE_REASONS[reason] ?? "The farm session ended.";
}

export function farmDeviceLabel(d: Pick<FarmDevice, "id" | "marketingName" | "model">): string {
  return d.marketingName ?? d.model ?? d.id;
}

async function farmFetch<T>(path: string, init: Parameters<typeof fetch>[1] = {}): Promise<T> {
  const token = await getCloudIdToken();
  const res = await fetch(`${CLOUD_DASHBOARD_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const code = typeof body.error === "string" ? body.error : String(res.status);
    throw new FarmApiError(
      code,
      MESSAGES[code] ?? `Device farm error (${code}).`,
      typeof body.sessionId === "string" ? body.sessionId : undefined,
    );
  }
  return body as T;
}

export const farmApi = {
  listDevices: async () =>
    (await farmFetch<{ devices: FarmDevice[] }>("/api/farm/devices")).devices,
  open: (deviceId: string) =>
    farmFetch<FarmOpen>("/api/farm/sessions", {
      method: "POST",
      body: JSON.stringify({ deviceId }),
    }),
  release: async (sessionId: string) => {
    await farmFetch(`/api/farm/sessions/${sessionId}`, { method: "DELETE" });
  },
  reconnect: (sessionId: string) =>
    farmFetch<FarmOpen>(`/api/farm/sessions/${sessionId}/reconnect`, { method: "POST" }),
};
