// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useChatStore } from "@/stores/chatStore";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";

/** Whether "Ask Billy" is offered: with the hosted Billy only, and only
 *  signed in — the setup where asking can't dead-end on a missing key or
 *  account. */
export function useCanAskBilly(): boolean {
  const hosted = useChatStore((s) => s.currentProvider === "maestrodeck");
  const signedIn = useCloudAuthStore((s) => s.user !== null);
  return hosted && signedIn;
}
