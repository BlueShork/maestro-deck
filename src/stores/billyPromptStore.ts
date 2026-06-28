// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface BillyPromptState {
  /**
   * User override for Billy's system prompt. `null` means "no override" — the
   * app falls back to the embedded `BILLY_SYSTEM_PROMPT`. Storing null (rather
   * than a copy of the default) means users who never customized keep receiving
   * the latest embedded prompt as the app updates; only those who overrode keep
   * their own version.
   */
  customPrompt: string | null;
  /** Persist an override. Blank/whitespace-only input is treated as a reset so
   *  Billy never ends up with an empty system prompt. */
  setCustomPrompt: (prompt: string) => void;
  /** Drop the override and fall back to the embedded default. */
  reset: () => void;
}

export const useBillyPromptStore = create<BillyPromptState>()(
  persist(
    (set) => ({
      customPrompt: null,
      setCustomPrompt: (prompt) => set({ customPrompt: prompt.trim() === "" ? null : prompt }),
      reset: () => set({ customPrompt: null }),
    }),
    {
      name: "maestro-deck.billy-prompt",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
