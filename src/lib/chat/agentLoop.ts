// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ChatMessage, ContentBlock, ImagePart, ToolSpec } from "@/types/chat";

import { truncateToolResults } from "./content";
import type { ChatProvider } from "./provider";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; block: Extract<ContentBlock, { type: "tool_use" }> }
  | { type: "tool_result"; block: Extract<ContentBlock, { type: "tool_result" }> }
  | { type: "turn_limit" };

export const MAX_TOOL_TURNS = 25;
export const TURN_LIMIT_NOTICE =
  "Billy a atteint la limite de 25 étapes — envoie un message pour continuer.";

export interface AgentLoopArgs {
  provider: ChatProvider;
  model: string;
  tools: ToolSpec[];
  /** Full conversation INCLUDING the new user message; system+context first. */
  messages: ChatMessage[];
  signal: AbortSignal;
  execute: (
    name: string,
    input: unknown,
    signal?: AbortSignal,
  ) => Promise<{ content: string | ImagePart; isError: boolean }>;
}

// ---------------------------------------------------------------------------
// Core loop
// ---------------------------------------------------------------------------

export async function* runAgentLoop(args: AgentLoopArgs): AsyncGenerator<AgentEvent> {
  const { provider, model, tools, signal, execute } = args;
  // Working copy: the loop appends assistant turns + tool results as it goes.
  const messages = args.messages.slice();
  let toolTurns = 0;

  for (;;) {
    const blocks: ContentBlock[] = [];
    let text = "";
    let stop: "end_turn" | "tool_use" | "max_tokens" = "end_turn";

    for await (const evt of provider.stream({
      model,
      messages: truncateToolResults(messages),
      tools,
      signal,
    })) {
      if (evt.type === "text_delta") {
        text += evt.text;
        yield { type: "text_delta", text: evt.text };
      } else if (evt.type === "tool_use") {
        if (text) {
          blocks.push({ type: "text", text });
          text = "";
        }
        blocks.push({ type: "tool_use", id: evt.id, name: evt.name, input: evt.input });
      } else {
        stop = evt.reason;
      }
    }
    if (text) blocks.push({ type: "text", text });

    const toolUses = blocks.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    if (stop !== "tool_use" || toolUses.length === 0) return;

    toolTurns++;
    if (toolTurns > MAX_TOOL_TURNS) {
      yield { type: "turn_limit" };
      return;
    }

    for (const tu of toolUses) {
      yield { type: "tool_use", block: tu };
      if (signal.aborted) return;
      const { content, isError } = await execute(tu.name, tu.input, signal);
      const result: ContentBlock = {
        type: "tool_result",
        toolUseId: tu.id,
        name: tu.name,
        content,
        ...(isError ? { isError: true } : {}),
      };
      blocks.push(result);
      yield { type: "tool_result", block: result };
    }
    if (signal.aborted) return;

    messages.push({
      id: crypto.randomUUID(),
      role: "assistant",
      content: blocks,
      createdAt: Date.now(),
    });
  }
}
