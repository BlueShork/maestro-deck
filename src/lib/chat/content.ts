// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ChatMessage, ContentBlock } from "@/types/chat";

/** Plain-text view of a message: string content as-is, blocks joined text. */
export function messageText(m: Pick<ChatMessage, "content">): string {
  if (typeof m.content === "string") return m.content;
  return m.content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}

const KEEP_FULL = 4;
const MAX_CHARS = 2000;

/** Bound old tool_result payloads before sending history to the provider.
 *  The KEEP_FULL most recent string tool_results (across all messages) stay
 *  intact; older ones are cut to MAX_CHARS with a marker. Images and
 *  non-tool blocks pass through untouched. Returns new objects; never
 *  mutates the input (the UI store keeps the full content). */
export function truncateToolResults(messages: ChatMessage[]): ChatMessage[] {
  const resultPositions: { mi: number; bi: number }[] = [];
  messages.forEach((m, mi) => {
    if (typeof m.content === "string") return;
    m.content.forEach((b, bi) => {
      if (b.type === "tool_result" && typeof b.content === "string") {
        resultPositions.push({ mi, bi });
      }
    });
  });
  const cutSet = new Set(
    resultPositions
      .slice(0, Math.max(0, resultPositions.length - KEEP_FULL))
      .map((p) => `${p.mi}:${p.bi}`),
  );
  if (cutSet.size === 0) return messages;
  return messages.map((m, mi) => {
    if (typeof m.content === "string") return m;
    let changed = false;
    const blocks = m.content.map((b, bi) => {
      if (
        b.type === "tool_result" &&
        typeof b.content === "string" &&
        cutSet.has(`${mi}:${bi}`) &&
        b.content.length > MAX_CHARS
      ) {
        changed = true;
        return { ...b, content: b.content.slice(0, MAX_CHARS) + "\n… [truncated]" };
      }
      return b;
    });
    return changed ? { ...m, content: blocks } : m;
  });
}
