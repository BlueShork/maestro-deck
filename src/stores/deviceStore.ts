import { create } from "zustand";

import { ipc } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { Device } from "@/types";

interface DeviceState {
  devices: Device[];
  current: Device | null;
  loading: boolean;
  connecting: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  connect: (serial: string) => Promise<void>;
  disconnect: () => Promise<void>;
  markDisconnected: () => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => ({
  devices: [],
  current: null,
  loading: false,
  connecting: false,
  error: null,
  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const devices = await ipc.listDevices();
      set({ devices, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ loading: false, error: message, devices: [] });
      toast.error("Failed to list devices", message);
    }
  },
  connect: async (serial) => {
    const device = get().devices.find((d) => d.serial === serial);
    set({ connecting: true, error: null });
    try {
      await ipc.connectDevice(serial);
      set({ current: device ?? null, connecting: false });
      toast.success("Device connected", device?.model ?? serial);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ connecting: false, error: message });
      toast.error("Connect failed", message);
    }
  },
  disconnect: async () => {
    try {
      await ipc.disconnectDevice();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Disconnect failed", message);
    } finally {
      set({ current: null });
    }
  },
  markDisconnected: () => {
    set({ current: null });
    toast.info("Device disconnected");
  },
}));
