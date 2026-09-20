// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";

import type { CloudUser } from "@/lib/cloudAuth";
import { onCloudAuthStateChanged } from "@/lib/cloudAuth";

interface CloudAuthState {
  /** null until Firebase's first callback fires, then either the signed-in
   *  user or null. Signing in is entirely optional — nothing else in the
   *  app depends on this being set. */
  user: CloudUser | null;
  ready: boolean;
}

export const useCloudAuthStore = create<CloudAuthState>(() => ({
  user: null,
  ready: false,
}));

let unsubscribe: (() => void) | null = null;

/** Starts (once) the Firebase auth listener that keeps the store in sync.
 *  Firebase persists the session itself across app restarts, so this just
 *  needs to run once at startup. */
export function startCloudAuthListener() {
  if (unsubscribe) return unsubscribe;
  unsubscribe = onCloudAuthStateChanged((user) => {
    useCloudAuthStore.setState({ user, ready: true });
  });
  return unsubscribe;
}
