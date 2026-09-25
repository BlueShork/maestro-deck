// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

// Vite imports the markdown as a plain string at build time. Edit
// `billy-prompt.md` to change the assistant's personality / knowledge —
// no code changes needed, just bump the .md and rebuild.
import prompt from "./billy-prompt.md?raw";
import toolsPrompt from "./billy-tools-prompt.md?raw";

import { useBillyPromptStore } from "@/stores/billyPromptStore";

export const BILLY_SYSTEM_PROMPT: string = prompt;

/** Operating manual for Billy's tools. Kept OUT of the user-editable
 *  personality prompt: a custom prompt saved before (or without) this
 *  section must not silently strip Billy of his tool guidance. */
export const BILLY_TOOLS_PROMPT: string = toolsPrompt;

/**
 * The system prompt Billy should actually use: the user's override when set,
 * otherwise the embedded default — always followed by the tools manual.
 * Read fresh on each call (don't cache) so an edit in Settings takes effect
 * on the next message without a reload.
 */
export function getEffectiveBillyPrompt(): string {
  const base = useBillyPromptStore.getState().customPrompt ?? BILLY_SYSTEM_PROMPT;
  return `${base.trimEnd()}\n\n${BILLY_TOOLS_PROMPT}`;
}
