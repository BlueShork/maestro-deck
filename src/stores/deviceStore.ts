// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import { flowUrl } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast } from "@/stores/toastStore";
import type { Device } from "@/types";

// Stable fingerprint of the device list so the background poll can skip
// state updates (and re-renders) when nothing actually changed.
const deviceListKey = (devices: Device[]): string =>
  devices
    .map((d) => `${d.serial}|${d.platform}|${d.booted ? 1 : 0}|${d.physical ? 1 : 0}|${d.model}`)
    .sort()
    .join(",");

interface DeviceState {
  devices: Device[];
  current: Device | null;
  loading: boolean;
  connecting: boolean;
  /**
   * Serial of the device we are currently connecting/disconnecting,
   * so the DeviceSelector can show an inline spinner on that exact
   * row instead of a global one. `null` when idle.
   */
  pendingSerial: string | null;
  pendingAction: "connect" | "disconnect" | null;
  error: string | null;
  /**
   * Re-list devices. Pass `{ silent: true }` for the background hotplug
   * poll: it skips the loading spinner, swallows transient errors, and
   * leaves the current list untouched unless something actually changed.
   */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  connect: (serial: string) => Promise<void>;
  disconnect: () => Promise<void>;
  markDisconnected: () => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  current: null,
  loading: false,
  connecting: false,
  pendingSerial: null,
  pendingAction: null,
  error: null,
  refresh: async (opts) => {
    const silent = opts?.silent ?? false;
    if (!silent) set({ loading: true, error: null });
    try {
      const devices = await ipc.listDevices();
      set((state) => {
        const changed = deviceListKey(state.devices) !== deviceListKey(devices);
        // Background poll fast-path: when nothing changed and there's no
        // spinner/error to clear, return the SAME state reference so zustand
        // skips the notify entirely. Otherwise the poll would re-render the
        // whole device list every tick and cause hover jank.
        if (silent && !changed && !state.loading && !state.error) {
          return state;
        }
        return {
          loading: false,
          error: null,
          ...(changed ? { devices } : {}),
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (silent) {
        // Transient poll failure (e.g. adb briefly busy) — keep the last
        // known list and stay quiet; the next tick will recover.
        set((state) => (state.loading ? { loading: false } : state));
      } else {
        set({ loading: false, error: message, devices: [] });
        toast.error("Failed to list devices", message);
      }
    }
  },
  connect: async (serial) => {
    const device = get().devices.find((d) => d.serial === serial);
    const streamEnabled = useSettingsStore.getState().streamEnabled;
    // Web targets start from the open flow's `url:` header (if any).
    const url = device?.platform === "web" ? flowUrl(useFlowStore.getState().content) : undefined;
    set({
      connecting: true,
      pendingSerial: serial,
      pendingAction: "connect",
      error: null,
    });
    try {
      await ipc.connectDevice(serial, streamEnabled, device?.platform ?? "android", url);
      set({
        current: device ?? null,
        connecting: false,
        pendingSerial: null,
        pendingAction: null,
      });
      toast.success(
        "Device connected",
        streamEnabled ? (device?.model ?? serial) : `${device?.model ?? serial} · stream off`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({
        connecting: false,
        pendingSerial: null,
        pendingAction: null,
        error: message,
      });
      toast.error("Connect failed", message);
    }
  },
  disconnect: async () => {
    const serial = get().current?.serial ?? null;
    set({ pendingSerial: serial, pendingAction: "disconnect" });
    try {
      await ipc.disconnectDevice();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Disconnect failed", message);
    } finally {
      set({ current: null, pendingSerial: null, pendingAction: null });
      useStreamStore.getState().reset();
    }
  },
  markDisconnected: () => {
    set({ current: null });
    useStreamStore.getState().reset();
    toast.info("Device disconnected");
  },
}));
