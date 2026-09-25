// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import type { CloudJobPlatform } from "@/lib/cloudJobs";

interface CloudTargetState {
  /**
   * Where Run sends the next flow. `null` means the connected local device,
   * which stays the default.
   *
   * Deliberately not a `Device` in deviceStore: a cloud profile has no serial,
   * is not reachable over adb, and feeds neither the inspector nor screenshots.
   * Every consumer of deviceStore assumes a local device, so a cloud entry
   * there would be a lie the whole app has to special-case.
   */
  target: CloudJobPlatform | null;
  select: (platform: CloudJobPlatform) => void;
  clear: () => void;
}

export const useCloudTargetStore = create<CloudTargetState>((set) => ({
  target: null,
  select: (target) => set({ target }),
  clear: () => set({ target: null }),
}));
