// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Pure request/SSE mapping for the Anthropic Messages API (direct + Vertex).
 * No side-effects: no fetch, no globals. Shared between AnthropicProvider
 * (Task 6) and VertexProvider (Task 7).
 */

import type { ChatMessage, ContentBlock, ImagePart, ProviderEvent, ToolSpec } from "@/types/chat";

// ---------------------------------------------------------------------------
// Request serialisation — toAnthropicBody
// ---------------------------------------------------------------------------

/** Shape of one serialised Anthropic API turn (messages array entry). */
type ApiTurn = { role: "assistant" | "user"; content: unknown };

/** Serialise a single non-result ContentBlock into an Anthropic API block. */
function serializeNonResultBlock(
  block: Extract<ContentBlock, { type: "text" | "tool_use" }>,
): unknown {
  if (block.type === "text") {
    return { type: "text", text: block.text };
  }
  // tool_use
  return { type: "tool_use", id: block.id, name: block.name, input: block.input };
}

/** Serialise a single tool_result ContentBlock into an Anthropic API block. */
function serializeToolResultBlock(block: Extract<ContentBlock, { type: "tool_result" }>): unknown {
  const content: ImagePart | string = block.content;
  const apiContent =
    typeof content === "string"
      ? content
      : [
          {
            type: "image",
            source: { type: "base64", media_type: content.mediaType, data: content.base64 },
          },
        ];
  return {
    type: "tool_result",
    tool_use_id: block.toolUseId,
    content: apiContent,
    is_error: block.isError,
  };
}

/**
 * Split a mixed ContentBlock[] into alternating API turns:
 *   consecutive non-result blocks → one `assistant` turn
 *   consecutive tool_result blocks → one `user` turn
 * Repeats in order.
 */
function splitBlocksToTurns(blocks: ContentBlock[]): ApiTurn[] {
  const turns: ApiTurn[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "tool_result") {
      // Collect consecutive tool_result blocks
      const group: unknown[] = [];
      while (i < blocks.length && blocks[i].type === "tool_result") {
        group.push(
          serializeToolResultBlock(blocks[i] as Extract<ContentBlock, { type: "tool_result" }>),
        );
        i++;
      }
      turns.push({ role: "user", content: group });
    } else {
      // Collect consecutive non-result blocks (text + tool_use)
      const group: unknown[] = [];
      while (i < blocks.length && blocks[i].type !== "tool_result") {
        group.push(
          serializeNonResultBlock(
            blocks[i] as Extract<ContentBlock, { type: "text" | "tool_use" }>,
          ),
        );
        i++;
      }
      turns.push({ role: "assistant", content: group });
    }
  }
  return turns;
}

/**
 * Serialise a ChatMessage into one or more API turns.
 * System messages are handled separately (returned as undefined here).
 */
function messageToTurns(msg: ChatMessage): ApiTurn[] {
  if (msg.role === "system") return [];

  if (typeof msg.content === "string") {
    return [{ role: msg.role as "user" | "assistant", content: msg.content }];
  }

  // Block message — only assistant messages should have blocks in practice.
  return splitBlocksToTurns(msg.content);
}

/** Normalize a turn's content to an array of block objects (never a plain string). */
function normalizeContent(content: unknown): unknown[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content as unknown[];
}

/**
 * Merge adjacent turns with the same role by concatenating their content
 * arrays. This prevents consecutive same-role turns that the API rejects
 * (e.g. a tool_result user turn immediately followed by a new user message).
 */
function mergeAdjacentTurns(turns: ApiTurn[]): ApiTurn[] {
  if (turns.length === 0) return turns;
  const merged: ApiTurn[] = [];
  for (const turn of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = [...normalizeContent(prev.content), ...normalizeContent(turn.content)];
    } else {
      merged.push({ role: turn.role, content: turn.content });
    }
  }
  return merged;
}

export interface ToAnthropicBodyOpts {
  /** When true: include `anthropic_version`, omit `model` (Vertex Claude). */
  vertex: boolean;
}

/**
 * Build an Anthropic Messages API request body from chat history and tools.
 *
 * When `opts.vertex` is true the body includes `anthropic_version` and no
 * `model` key — the caller is responsible for inserting `model` for direct
 * API calls, or for the Vertex URL routing for Vertex calls.
 */
export function toAnthropicBody(
  messages: ChatMessage[],
  tools: ToolSpec[],
  opts: ToAnthropicBodyOpts,
): object {
  // System messages → system block array with cache_control
  const systemText = messages
    .filter((m) => m.role === "system")
    .map((m) =>
      typeof m.content === "string"
        ? m.content
        : m.content
            .filter((b) => b.type === "text")
            .map((b) => (b as Extract<ContentBlock, { type: "text" }>).text)
            .join(""),
    )
    .join("\n\n");

  const system = systemText
    ? [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }]
    : undefined;

  // Non-system messages → API turns (merge adjacent same-role turns so we
  // never send consecutive user or assistant entries to the API).
  const apiTurns = mergeAdjacentTurns(
    messages.filter((m) => m.role !== "system").flatMap(messageToTurns),
  );

  // Tools → Anthropic format (omit entirely when empty)
  const apiTools =
    tools.length > 0
      ? tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        }))
      : undefined;

  const base: Record<string, unknown> = {
    max_tokens: 4096,
    stream: true,
    ...(system !== undefined && { system }),
    messages: apiTurns,
    ...(apiTools !== undefined && { tools: apiTools }),
  };

  if (opts.vertex) {
    base.anthropic_version = "vertex-2023-10-16";
  }

  return base;
}

// ---------------------------------------------------------------------------
// SSE mapping — mapAnthropicSSE
// ---------------------------------------------------------------------------

interface RawContentBlockStart {
  type: "content_block_start";
  index: number;
  content_block: { type: string; id?: string; name?: string };
}

interface RawContentBlockDelta {
  type: "content_block_delta";
  index: number;
  delta: { type: string; text?: string; partial_json?: string };
}

interface RawContentBlockStop {
  type: "content_block_stop";
  index: number;
}

interface RawMessageDelta {
  type: "message_delta";
  delta: { stop_reason?: string };
}

type RawEvent =
  | RawContentBlockStart
  | RawContentBlockDelta
  | RawContentBlockStop
  | RawMessageDelta
  | { type: "message_stop" }
  | { type: string };

interface ToolAccumulator {
  id: string;
  name: string;
  json: string;
}

/**
 * Map a stream of raw Anthropic SSE JSON events into ProviderEvents.
 *
 * Handles:
 * - text_delta → {type:"text_delta"}
 * - tool_use content blocks (accumulated input_json_delta chunks)
 * - message_stop → {type:"stop", reason}
 */
export async function* mapAnthropicSSE(
  events: AsyncIterable<unknown>,
): AsyncGenerator<ProviderEvent> {
  // Map from block index to in-progress tool accumulator
  const toolAccumulators = new Map<number, ToolAccumulator>();
  let stopReason: string | undefined;

  for await (const raw of events) {
    const evt = raw as RawEvent;

    if (evt.type === "content_block_start") {
      const e = evt as RawContentBlockStart;
      if (e.content_block.type === "tool_use" && e.content_block.id && e.content_block.name) {
        toolAccumulators.set(e.index, {
          id: e.content_block.id,
          name: e.content_block.name,
          json: "",
        });
      }
    } else if (evt.type === "content_block_delta") {
      const e = evt as RawContentBlockDelta;
      if (e.delta.type === "text_delta" && e.delta.text != null) {
        yield { type: "text_delta", text: e.delta.text };
      } else if (e.delta.type === "input_json_delta" && e.delta.partial_json != null) {
        const acc = toolAccumulators.get(e.index);
        if (acc) {
          acc.json += e.delta.partial_json;
        }
      }
    } else if (evt.type === "content_block_stop") {
      const e = evt as RawContentBlockStop;
      const acc = toolAccumulators.get(e.index);
      if (acc) {
        let input: unknown;
        try {
          input = JSON.parse(acc.json || "{}");
        } catch {
          input = {};
        }
        yield { type: "tool_use", id: acc.id, name: acc.name, input };
        toolAccumulators.delete(e.index);
      }
    } else if (evt.type === "message_delta") {
      const e = evt as RawMessageDelta;
      stopReason = e.delta.stop_reason;
    } else if (evt.type === "message_stop") {
      const knownReasons = new Set(["end_turn", "tool_use", "max_tokens"]);
      const reason = knownReasons.has(stopReason ?? "")
        ? (stopReason as "end_turn" | "tool_use" | "max_tokens")
        : "end_turn";
      yield { type: "stop", reason };
    }
  }
}
