// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import type { CloudBillingInfo, CloudUser } from "@/lib/cloudAuth";
import { fetchCloudBilling, onCloudAuthStateChanged } from "@/lib/cloudAuth";

interface CloudAuthState {
  /** null until Firebase's first callback fires, then either the signed-in
   *  user or null. Signing in is entirely optional — nothing else in the
   *  app depends on this being set. */
  user: CloudUser | null;
  ready: boolean;
  billing: CloudBillingInfo | null;
  billingLoading: boolean;
  billingError: string | null;
  refreshBilling: () => Promise<void>;
}

export const useCloudAuthStore = create<CloudAuthState>((set, get) => ({
  user: null,
  ready: false,
  billing: null,
  billingLoading: false,
  billingError: null,

  refreshBilling: async () => {
    if (!get().user) return;
    set({ billingLoading: true, billingError: null });
    try {
      const billing = await fetchCloudBilling();
      set({ billing, billingLoading: false });
    } catch (err) {
      set({
        billingLoading: false,
        billingError: err instanceof Error ? err.message : "Could not load billing info",
      });
    }
  },
}));

let started = false;

/** Starts (once, for the app's whole lifetime) the Firebase auth listener
 *  that keeps the store in sync. Deliberately doesn't return the Firebase
 *  unsubscribe function: React StrictMode double-invokes effects in dev
 *  (mount → cleanup → mount), and returning it here would let React treat
 *  it as this effect's cleanup, killing the listener after the very first
 *  mount cycle with no way to restart it. This listener is meant to outlive
 *  any single component, so it never unsubscribes. */
export function startCloudAuthListener() {
  if (started) return;
  started = true;
  onCloudAuthStateChanged((user) => {
    useCloudAuthStore.setState({ user, ready: true, billing: null, billingError: null });
    if (user) void useCloudAuthStore.getState().refreshBilling();
  });
}

// This module owns process-wide singletons: the zustand store instance and a
// Firebase listener that writes into it. A hot swap replaces the store the UI
// reads while the already-registered listener keeps writing to the old one, so
// a successful sign-in silently never reaches the screen. Force a full reload
// instead of a hot patch — it costs a second in dev and keeps the two in sync.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot?.invalidate();
  });
}
