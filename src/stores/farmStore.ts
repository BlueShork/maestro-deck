// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import {
  closeReasonMessage,
  farmApi,
  FarmApiError,
  farmDeviceLabel,
  type FarmDevice,
} from "@/lib/farmApi";
import { ipc, type FarmSessionEvent } from "@/lib/ipc";
import { useDeviceStore } from "@/stores/deviceStore";
import { toast } from "@/stores/toastStore";

export interface FarmSessionState {
  sessionId: string;
  deviceId: string;
  label: string;
  gatewayUrl: string;
  startedAt: number;
  minutesRemaining: number;
  maxEndsAt: number;
  status: "connecting" | "active" | "reconnecting";
}

interface FarmState {
  devices: FarmDevice[];
  loadingDevices: boolean;
  devicesError: string | null;
  session: FarmSessionState | null;
  /** Deadlines announced by the gateway; the bar hides each once it has passed. */
  warnings: { idle?: number; minutes?: number };
  installing: boolean;
  start: () => Promise<void>;
  refreshDevices: () => Promise<void>;
  connect: (device: FarmDevice) => Promise<void>;
  release: () => Promise<void>;
  installApk: (path: string) => Promise<void>;
  handleEvent: (event: FarmSessionEvent) => void;
  /** The device was disconnected elsewhere (sidebar, quit): forget the session. */
  forget: () => void;
}

const RECONNECT_WINDOW_MS = 55_000;
const RECONNECT_RETRY_MS = 3_000;
let unlisten: (() => void) | null = null;
/** Bumped by every connect and release: a connect that finds it changed was cancelled. */
let attempt = 0;

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const useFarmStore = create<FarmState>((set, get) => ({
  devices: [],
  loadingDevices: false,
  devicesError: null,
  session: null,
  warnings: {},
  installing: false,

  start: async () => {
    if (unlisten) return;
    unlisten = await ipc.onFarmSession((e) => get().handleEvent(e));
  },

  refreshDevices: async () => {
    set({ loadingDevices: true });
    try {
      set({ devices: await farmApi.listDevices(), devicesError: null, loadingDevices: false });
    } catch (err) {
      set({ devicesError: message(err), loadingDevices: false });
    }
  },

  connect: async (device) => {
    if (get().session) {
      toast.error("Can't open the farm phone", "Release the current farm phone first.");
      return;
    }
    const label = farmDeviceLabel(device);
    const mine = ++attempt;
    // The previous device's canvas would sit frozen during the (up to 60 s) hello wait.
    useDeviceStore.getState().clearCurrent();
    set({
      session: {
        sessionId: "",
        deviceId: device.id,
        label,
        gatewayUrl: "",
        startedAt: Date.now(),
        minutesRemaining: 0,
        maxEndsAt: 0,
        status: "connecting",
      },
      warnings: {},
    });
    let opened;
    try {
      opened = await farmApi.open(device.id);
    } catch (err) {
      set({ session: null });
      toast.error(
        "Can't open the farm phone",
        err instanceof FarmApiError ? err.message : message(err),
      );
      void get().refreshDevices();
      return;
    }
    if (mine !== attempt) {
      // Released while the dashboard was opening: give the phone back.
      void farmApi.release(opened.sessionId).catch(() => undefined);
      return;
    }
    set((s) =>
      s.session
        ? { session: { ...s.session, sessionId: opened.sessionId, gatewayUrl: opened.gatewayUrl } }
        : s,
    );
    try {
      const connected = await ipc.connectFarmDevice(opened.gatewayUrl, opened.token);
      if (mine !== attempt) {
        void ipc.disconnectDevice().catch(() => undefined);
        void farmApi.release(opened.sessionId).catch(() => undefined);
        return;
      }
      useDeviceStore.getState().setCurrent(connected);
      set((s) =>
        s.session ? { session: { ...s.session, status: "active", startedAt: Date.now() } } : s,
      );
      toast.success("Farm phone connected", label);
    } catch (err) {
      // Reserved but never usable: give the phone back right away.
      void farmApi.release(opened.sessionId).catch(() => undefined);
      set({ session: null });
      toast.error("Can't open the farm phone", message(err));
    }
  },

  release: async () => {
    const session = get().session;
    if (!session) return;
    attempt++;
    set({ session: null, warnings: {} });
    try {
      await ipc.disconnectDevice();
    } finally {
      useDeviceStore.getState().clearCurrent();
      // Also covers a session still opening on the gateway (dashboard asks it to close).
      if (session.sessionId) void farmApi.release(session.sessionId).catch(() => undefined);
      void get().refreshDevices();
    }
  },

  installApk: async (path) => {
    set({ installing: true });
    try {
      const result = await ipc.farmInstallApk(path);
      if (result.ok)
        toast.success("App installed", result.packages.join(", ") || "Installed on the farm phone");
      else toast.error("Install failed", result.message);
    } catch (err) {
      toast.error("Install failed", message(err));
    } finally {
      set({ installing: false });
    }
  },

  handleEvent: (event) => {
    const session = get().session;
    switch (event.type) {
      case "hello":
        if (session) {
          set({
            session: {
              ...session,
              minutesRemaining: event.hello.minutesRemaining,
              maxEndsAt: event.hello.maxEndsAt,
              status: session.status === "connecting" ? "active" : session.status,
            },
          });
        }
        return;
      case "idle_warning":
        set((st) => ({ warnings: { ...st.warnings, idle: event.closes_at } }));
        return;
      case "minutes_warning":
        set((st) => ({ warnings: { ...st.warnings, minutes: event.closes_at } }));
        return;
      case "reconnecting":
        if (!session) return;
        set({ session: { ...session, status: "reconnecting" } });
        void reconnectLoop(session.sessionId);
        return;
      case "reconnected":
        if (session) set({ session: { ...session, status: "active" } });
        return;
      case "closing":
        set({ session: null, warnings: {} });
        useDeviceStore.getState().clearCurrent();
        // The native side drops the session too; this also covers a close it missed.
        void ipc.disconnectDevice().catch(() => undefined);
        toast.info("Farm session ended", closeReasonMessage(event.reason));
        void get().refreshDevices();
        return;
      case "error":
        toast.error("Farm phone", event.message);
        return;
    }
  },

  forget: () => set({ session: null, warnings: {} }),
}));

async function reconnectLoop(sessionId: string): Promise<void> {
  const deadline = Date.now() + RECONNECT_WINDOW_MS;
  while (Date.now() < deadline) {
    const session = useFarmStore.getState().session;
    if (!session || session.sessionId !== sessionId || session.status !== "reconnecting") return;
    try {
      const fresh = await farmApi.reconnect(sessionId);
      await ipc.farmReconnect(fresh.gatewayUrl, fresh.token);
      return;
    } catch (err) {
      if (err instanceof FarmApiError && (err.code === "not_active" || err.code === "not_found"))
        break;
      await new Promise((r) => setTimeout(r, RECONNECT_RETRY_MS));
    }
  }
  if (useFarmStore.getState().session?.sessionId === sessionId) {
    useFarmStore.getState().handleEvent({ type: "closing", reason: "disconnected" });
    void ipc.disconnectDevice().catch(() => undefined);
  }
}
