// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Pure request/SSE mapping for the Google Gemini API on Vertex AI.
 * No side-effects: no fetch, no globals.
 */

import type { ChatMessage, ContentBlock, ImagePart, ProviderEvent, ToolSpec } from "@/types/chat";

// ---------------------------------------------------------------------------
// Request serialisation — toGeminiBody
// ---------------------------------------------------------------------------

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: unknown } }
  | { functionResponse: { name: string; response: { result: string } } }
  | { inline_data: { mime_type: string; data: string } };

type GeminiTurn = { role: "user" | "model"; parts: GeminiPart[] };

/** Serialise non-result blocks (text + tool_use) into Gemini parts for a model turn. */
function nonResultPartsFromBlocks(
  blocks: Extract<ContentBlock, { type: "text" | "tool_use" }>[],
): GeminiPart[] {
  return blocks.map((block) => {
    if (block.type === "text") {
      return { text: block.text };
    }
    // tool_use
    return { functionCall: { name: block.name, args: block.input } };
  });
}

/** Serialise tool_result blocks into Gemini parts for a user turn. */
function resultPartsFromBlocks(
  blocks: Extract<ContentBlock, { type: "tool_result" }>[],
): GeminiPart[] {
  const parts: GeminiPart[] = [];
  for (const block of blocks) {
    const content: string | ImagePart = block.content;
    if (typeof content === "string") {
      parts.push({
        functionResponse: { name: block.name, response: { result: content } },
      });
    } else {
      // Image result: note in functionResponse, then inline_data
      parts.push({
        functionResponse: {
          name: block.name,
          response: { result: "(screenshot attached as image)" },
        },
      });
      parts.push({
        inline_data: { mime_type: content.mediaType, data: content.base64 },
      });
    }
  }
  return parts;
}

/**
 * Split a mixed ContentBlock[] into alternating Gemini turns:
 *   consecutive non-result blocks → one `model` turn
 *   consecutive tool_result blocks → one `user` turn
 */
function splitBlocksToGeminiTurns(blocks: ContentBlock[]): GeminiTurn[] {
  const turns: GeminiTurn[] = [];
  let i = 0;
  while (i < blocks.length) {
    const block = blocks[i];
    if (block.type === "tool_result") {
      const group: Extract<ContentBlock, { type: "tool_result" }>[] = [];
      while (i < blocks.length && blocks[i].type === "tool_result") {
        group.push(blocks[i] as Extract<ContentBlock, { type: "tool_result" }>);
        i++;
      }
      turns.push({ role: "user", parts: resultPartsFromBlocks(group) });
    } else {
      const group: Extract<ContentBlock, { type: "text" | "tool_use" }>[] = [];
      while (i < blocks.length && blocks[i].type !== "tool_result") {
        group.push(blocks[i] as Extract<ContentBlock, { type: "text" | "tool_use" }>);
        i++;
      }
      turns.push({ role: "model", parts: nonResultPartsFromBlocks(group) });
    }
  }
  return turns;
}

/** Serialise a ChatMessage into Gemini turns (system handled separately). */
function messageToGeminiTurns(msg: ChatMessage): GeminiTurn[] {
  if (msg.role === "system") return [];

  if (typeof msg.content === "string") {
    const role = msg.role === "assistant" ? "model" : "user";
    return [{ role, parts: [{ text: msg.content }] }];
  }

  // Block message — split into alternating model/user turns
  return splitBlocksToGeminiTurns(msg.content);
}

/**
 * Merge adjacent Gemini turns with the same role by concatenating their parts.
 * Prevents consecutive same-role turns that the Gemini API rejects.
 */
function mergeAdjacentGeminiTurns(turns: GeminiTurn[]): GeminiTurn[] {
  if (turns.length === 0) return turns;
  const merged: GeminiTurn[] = [];
  for (const turn of turns) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts = [...prev.parts, ...turn.parts];
    } else {
      merged.push({ role: turn.role, parts: [...turn.parts] });
    }
  }
  return merged;
}

/**
 * Build a Gemini generateContent request body from chat history and tools.
 */
export function toGeminiBody(messages: ChatMessage[], tools: ToolSpec[]): object {
  // System messages → systemInstruction
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

  const systemInstruction = systemText
    ? { role: "system", parts: [{ text: systemText }] }
    : undefined;

  // Non-system messages → Gemini turns (merge adjacent same-role turns so we
  // never send consecutive user or model entries to the API).
  const contents = mergeAdjacentGeminiTurns(
    messages.filter((m) => m.role !== "system").flatMap(messageToGeminiTurns),
  );

  // Tools → Gemini functionDeclarations format (omit when empty)
  const apiTools =
    tools.length > 0
      ? [
          {
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.inputSchema,
            })),
          },
        ]
      : undefined;

  return {
    ...(systemInstruction !== undefined && { systemInstruction }),
    contents,
    ...(apiTools !== undefined && { tools: apiTools }),
  };
}

// ---------------------------------------------------------------------------
// SSE mapping — mapGeminiSSE
// ---------------------------------------------------------------------------

interface GeminiPart_Raw {
  text?: string;
  functionCall?: { name: string; args?: unknown };
}

interface GeminiCandidate_Raw {
  content?: { parts?: GeminiPart_Raw[] };
  finishReason?: string | null;
}

interface GeminiEvent_Raw {
  candidates?: GeminiCandidate_Raw[];
}

/**
 * Map a stream of raw Gemini SSE JSON events into ProviderEvents.
 *
 * Handles:
 * - text parts → {type:"text_delta"}
 * - functionCall parts → {type:"tool_use"} with synthesized ids call_0, call_1, …
 * - finishReason → determines stop reason at stream end
 */
export async function* mapGeminiSSE(events: AsyncIterable<unknown>): AsyncGenerator<ProviderEvent> {
  let callCounter = 0;
  let sawFunctionCall = false;
  let lastFinishReason: string | null = null;

  for await (const raw of events) {
    const evt = raw as GeminiEvent_Raw;
    const candidate = evt.candidates?.[0];
    if (!candidate) continue;

    if (candidate.finishReason) {
      lastFinishReason = candidate.finishReason;
    }

    const parts = candidate.content?.parts ?? [];
    for (const part of parts) {
      if (part.text != null) {
        yield { type: "text_delta", text: part.text };
      } else if (part.functionCall) {
        sawFunctionCall = true;
        const id = `call_${callCounter++}`;
        yield {
          type: "tool_use",
          id,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        };
      }
    }
  }

  // Emit stop event
  let reason: "end_turn" | "tool_use" | "max_tokens";
  if (sawFunctionCall) {
    reason = "tool_use";
  } else if (lastFinishReason === "MAX_TOKENS") {
    reason = "max_tokens";
  } else {
    reason = "end_turn";
  }

  yield { type: "stop", reason };
}
