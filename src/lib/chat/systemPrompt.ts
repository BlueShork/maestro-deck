// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

// Vite imports the markdown as a plain string at build time. Edit
// `billy-prompt.md` to change the assistant's personality / knowledge —
// no code changes needed, just bump the .md and rebuild.
import prompt from "./billy-prompt.md?raw";

import { useBillyPromptStore } from "@/stores/billyPromptStore";

export const BILLY_SYSTEM_PROMPT: string = prompt;

/**
 * The system prompt Billy should actually use: the user's override when set,
 * otherwise the embedded default. Read fresh on each call (don't cache) so an
 * edit in Settings takes effect on the next message without a reload.
 */
export function getEffectiveBillyPrompt(): string {
  return useBillyPromptStore.getState().customPrompt ?? BILLY_SYSTEM_PROMPT;
}
