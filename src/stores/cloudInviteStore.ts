// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface CloudInviteState {
  /** Survives restarts: this is a one-time ask, not a recurring prompt. */
  asked: boolean;
  open: boolean;
  /** Makes the offer once, at a moment the caller judges right. No-ops ever
   *  after, whatever the user did with it — declining is a final answer. */
  offer: () => void;
  close: () => void;
}

export const useCloudInviteStore = create<CloudInviteState>()(
  persist(
    (set, get) => ({
      asked: false,
      open: false,
      offer: () => {
        if (get().asked) return;
        // Marked asked on show, not on answer: a dialog the user closed by
        // pressing Escape still counts as having been asked.
        set({ asked: true, open: true });
      },
      close: () => set({ open: false }),
    }),
    {
      name: "maestro-deck.cloud-invite",
      storage: createJSONStorage(() => localStorage),
      // Only the "asked" flag survives reloads; visibility is in-memory.
      partialize: (s) => ({ asked: s.asked }),
    },
  ),
);
