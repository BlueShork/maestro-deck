// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Pure request/SSE mapping for the Mistral chat completions format (OpenAI
 * style), which the Maestro Deck provider's server route forwards as-is.
 * No side-effects: no fetch, no globals.
 */

import type { ChatMessage, ContentBlock, ProviderEvent, ToolSpec } from "@/types/chat";

// ---------------------------------------------------------------------------
// Request serialisation — toMistralBody
// ---------------------------------------------------------------------------

type MistralPart = { type: "text"; text: string } | { type: "image_url"; image_url: string };

type MistralToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type MistralMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | MistralPart[] }
  | { role: "assistant"; content: string; tool_calls?: MistralToolCall[] }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

type TextOrToolUse = Extract<ContentBlock, { type: "text" | "tool_use" }>;
type ToolResult = Extract<ContentBlock, { type: "tool_result" }>;

const ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * Mistral only accepts tool call ids of exactly 9 alphanumerics. Its own ids
 * pass through; any other (a conversation started on Anthropic or Gemini) is
 * hashed to a stable 9-char id, so a call and its result still match.
 */
export function mistralToolCallId(id: string): string {
  if (/^[A-Za-z0-9]{9}$/.test(id)) return id;
  // Two FNV-1a passes with different seeds: enough bits for 9 base-62 chars.
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x811c9dc5) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 9; i++) {
    const n = i < 5 ? a : b;
    out += ID_ALPHABET[(n >>> ((i % 5) * 6)) % 62];
  }
  return out;
}

function textOf(m: ChatMessage): string {
  return typeof m.content === "string"
    ? m.content
    : m.content
        .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
        .map((b) => b.text)
        .join("");
}

/**
 * Serialise an assistant message whose blocks interleave text, tool calls and
 * tool results (the UI model) into Mistral turns: each run of text/tool_use
 * becomes one assistant turn, each run of results one `tool` turn per result.
 *
 * Mistral takes neither images in tool turns nor a user turn right after a
 * tool turn, so a screenshot goes in a user turn behind a short assistant
 * line that keeps the order valid.
 */
function blocksToMistral(blocks: ContentBlock[]): MistralMessage[] {
  const answered = new Set(
    blocks.filter((b): b is ToolResult => b.type === "tool_result").map((b) => b.toolUseId),
  );
  const out: MistralMessage[] = [];
  let i = 0;
  while (i < blocks.length) {
    if (blocks[i].type === "tool_result") {
      const images: MistralPart[] = [];
      let imageTool = "";
      while (i < blocks.length && blocks[i].type === "tool_result") {
        const r = blocks[i] as ToolResult;
        const isImage = typeof r.content !== "string";
        out.push({
          role: "tool",
          tool_call_id: mistralToolCallId(r.toolUseId),
          name: r.name,
          content:
            typeof r.content === "string"
              ? r.content
              : "(screenshot, attached in the next message)",
        });
        if (isImage && typeof r.content !== "string") {
          imageTool = r.name;
          images.push({
            type: "image_url",
            image_url: `data:${r.content.mediaType};base64,${r.content.base64}`,
          });
        }
        i++;
      }
      if (images.length) {
        out.push({ role: "assistant", content: "Here is the screenshot I took." });
        out.push({
          role: "user",
          content: [
            {
              type: "text",
              text: `The current screen of the connected device, as returned by ${imageTool}:`,
            },
            ...images,
          ],
        });
      }
      continue;
    }

    const group: TextOrToolUse[] = [];
    while (i < blocks.length && blocks[i].type !== "tool_result") {
      group.push(blocks[i] as TextOrToolUse);
      i++;
    }
    const content = group
      .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    // A call left without a result (the user stopped Billy mid-tool) can't
    // be sent: Mistral rejects a tool call nobody answered.
    const calls = group
      .filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
          b.type === "tool_use" && answered.has(b.id),
      )
      .map(
        (b): MistralToolCall => ({
          id: mistralToolCallId(b.id),
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        }),
      );
    if (calls.length) out.push({ role: "assistant", content, tool_calls: calls });
    else if (content.trim()) out.push({ role: "assistant", content });
  }
  return out;
}

/** Screenshots re-sent with every request; the server refuses more than 8. */
const KEEP_SCREENSHOTS = 4;

/** Keep only the most recent screenshots: older ones become a text note, so a
 *  long session doesn't resend every image it ever took. */
function dropOldScreenshots(messages: MistralMessage[]): MistralMessage[] {
  let kept = 0;
  return messages
    .slice()
    .reverse()
    .map((m): MistralMessage => {
      if (m.role !== "user" || typeof m.content === "string") return m;
      const content = m.content.filter((p) => p.type === "text" || kept++ < KEEP_SCREENSHOTS);
      return content.length === m.content.length
        ? m
        : {
            role: "user",
            content: [...content, { type: "text", text: "(older screenshot omitted)" }],
          };
    })
    .reverse();
}

/** Build the /api/assistant/agent request body from chat history and tools. */
export function toMistralBody(messages: ChatMessage[], tools: ToolSpec[]): object {
  const out: MistralMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = textOf(m);
      if (text.trim()) out.push({ role: "system", content: text });
    } else if (m.role === "user") {
      const text = textOf(m);
      if (text.trim()) out.push({ role: "user", content: text });
    } else if (typeof m.content === "string") {
      if (m.content.trim()) out.push({ role: "assistant", content: m.content });
    } else {
      out.push(...blocksToMistral(m.content));
    }
  }

  return {
    messages: dropOldScreenshots(out),
    tools: tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    })),
  };
}

// ---------------------------------------------------------------------------
// SSE mapping — mapMistralSSE
// ---------------------------------------------------------------------------

interface MistralToolCallDelta {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

interface MistralChunk {
  choices?: {
    delta?: {
      content?: string | { type?: string; text?: string }[] | null;
      tool_calls?: MistralToolCallDelta[] | null;
    };
    finish_reason?: string | null;
  }[];
}

function parseArguments(args: string): unknown {
  if (!args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

/**
 * Map Mistral's SSE chunks into ProviderEvents. Text streams as it arrives;
 * tool calls are accumulated per index (Mistral usually sends a call whole,
 * OpenAI-style servers stream the arguments) and emitted once the stream ends.
 */
export async function* mapMistralSSE(
  events: AsyncIterable<unknown>,
): AsyncGenerator<ProviderEvent> {
  const calls: { id: string; name: string; args: string }[] = [];
  let finish: string | null = null;

  for await (const raw of events) {
    const choice = (raw as MistralChunk).choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finish = choice.finish_reason;

    const content = choice.delta?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("")
          : "";
    if (text) yield { type: "text_delta", text };

    for (const delta of choice.delta?.tool_calls ?? []) {
      const index = delta.index ?? calls.length;
      const args = delta.function?.arguments;
      const piece = typeof args === "string" ? args : args ? JSON.stringify(args) : "";
      const call = calls[index];
      if (call) {
        call.args += piece;
        if (delta.function?.name) call.name = delta.function.name;
      } else {
        calls[index] = {
          id: delta.id ?? `call${index}`,
          name: delta.function?.name ?? "",
          args: piece,
        };
      }
    }
  }

  const complete = calls.filter((c) => c && c.name);
  for (const call of complete) {
    yield { type: "tool_use", id: call.id, name: call.name, input: parseArguments(call.args) };
  }

  yield {
    type: "stop",
    reason: complete.length ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn",
  };
}
