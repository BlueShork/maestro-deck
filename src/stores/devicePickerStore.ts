// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

interface DevicePickerState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

/** The full device picker overlay (every local, farm and cloud target). */
export const useDevicePickerStore = create<DevicePickerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
