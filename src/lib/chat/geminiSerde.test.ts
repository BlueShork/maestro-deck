// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import type { ChatMessage, ProviderEvent, ToolSpec } from "@/types/chat";

import { mapGeminiSSE, toGeminiBody } from "./geminiSerde";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function collect(gen: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const results: ProviderEvent[] = [];
  for await (const evt of gen) results.push(evt);
  return results;
}

async function* asyncOf<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

// ---------------------------------------------------------------------------
// toGeminiBody
// ---------------------------------------------------------------------------

describe("toGeminiBody", () => {
  const tools: ToolSpec[] = [
    {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ];

  it("maps user/assistant string messages to role user/model with text parts", () => {
    const messages: ChatMessage[] = [
      { id: "u", role: "user", content: "Hello", createdAt: 0 },
      { id: "a", role: "assistant", content: "Hi there", createdAt: 1 },
    ];
    const body = toGeminiBody(messages, []) as Record<string, unknown>;
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: "Hello" }] },
      { role: "model", parts: [{ text: "Hi there" }] },
    ]);
  });

  it("maps system messages to systemInstruction", () => {
    const messages: ChatMessage[] = [
      { id: "s", role: "system", content: "Be helpful.", createdAt: 0 },
      { id: "u", role: "user", content: "Go", createdAt: 1 },
    ];
    const body = toGeminiBody(messages, []) as Record<string, unknown>;
    expect(body.systemInstruction).toEqual({
      role: "system",
      parts: [{ text: "Be helpful." }],
    });
    // system messages should not appear in contents
    const contents = body.contents as Array<{ role: string }>;
    expect(contents.every((c) => c.role !== "system")).toBe(true);
  });

  it("omits systemInstruction when no system messages", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Hi", createdAt: 0 }];
    const body = toGeminiBody(messages, []) as Record<string, unknown>;
    expect(body.systemInstruction).toBeUndefined();
  });

  it("splits assistant block message into model(text+functionCall) / user(functionResponse) turns", () => {
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: [
          { type: "text", text: "Let me read that." },
          { type: "tool_use", id: "call_0", name: "read_file", input: { path: "foo.txt" } },
          {
            type: "tool_result",
            toolUseId: "call_0",
            name: "read_file",
            content: "file contents",
          },
        ],
        createdAt: 1,
      },
    ];
    const body = toGeminiBody(messages, []) as Record<string, unknown>;
    const contents = body.contents as Array<{ role: string; parts: unknown[] }>;
    expect(contents).toHaveLength(2);
    expect(contents[0].role).toBe("model");
    expect(contents[0].parts).toEqual([
      { text: "Let me read that." },
      { functionCall: { name: "read_file", args: { path: "foo.txt" } } },
    ]);
    expect(contents[1].role).toBe("user");
    expect(contents[1].parts).toEqual([
      { functionResponse: { name: "read_file", response: { result: "file contents" } } },
    ]);
  });

  it("image tool_result → functionResponse note + inline_data part", () => {
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: [
          { type: "tool_use", id: "call_0", name: "screenshot", input: {} },
          {
            type: "tool_result",
            toolUseId: "call_0",
            name: "screenshot",
            content: { kind: "image", mediaType: "image/png", base64: "abc123" },
          },
        ],
        createdAt: 1,
      },
    ];
    const body = toGeminiBody(messages, []) as Record<string, unknown>;
    const contents = body.contents as Array<{ role: string; parts: unknown[] }>;
    expect(contents).toHaveLength(2);
    expect(contents[1].role).toBe("user");
    expect(contents[1].parts).toEqual([
      {
        functionResponse: {
          name: "screenshot",
          response: { result: "(screenshot attached as image)" },
        },
      },
      { inline_data: { mime_type: "image/png", data: "abc123" } },
    ]);
  });

  it("includes functionDeclarations shape for tools", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Go", createdAt: 0 }];
    const body = toGeminiBody(messages, tools) as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        functionDeclarations: [
          {
            name: "read_file",
            description: "Read a file",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      },
    ]);
  });

  it("omits tools key entirely when tools is empty", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Go", createdAt: 0 }];
    const body = toGeminiBody(messages, []) as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// mapGeminiSSE
// ---------------------------------------------------------------------------

describe("mapGeminiSSE", () => {
  it("(a) text-only stream → text_deltas + stop end_turn", async () => {
    const events = asyncOf(
      { candidates: [{ content: { parts: [{ text: "Hello" }] }, finishReason: null }] },
      { candidates: [{ content: { parts: [{ text: " world" }] }, finishReason: "STOP" }] },
    );
    const result = await collect(mapGeminiSSE(events));
    expect(result).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("(b) one functionCall part + finishReason STOP → tool_use call_0 then stop tool_use", async () => {
    const events = asyncOf({
      candidates: [
        {
          content: {
            parts: [{ functionCall: { name: "read_file", args: { path: "foo.txt" } } }],
          },
          finishReason: "STOP",
        },
      ],
    });
    const result = await collect(mapGeminiSSE(events));
    expect(result).toEqual([
      { type: "tool_use", id: "call_0", name: "read_file", input: { path: "foo.txt" } },
      { type: "stop", reason: "tool_use" },
    ]);
  });

  it("(c) two functionCalls across events → ids call_0, call_1", async () => {
    const events = asyncOf(
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "read_file", args: { path: "a.txt" } } }],
            },
            finishReason: null,
          },
        ],
      },
      {
        candidates: [
          {
            content: {
              parts: [{ functionCall: { name: "read_file", args: { path: "b.txt" } } }],
            },
            finishReason: "STOP",
          },
        ],
      },
    );
    const result = await collect(mapGeminiSSE(events));
    expect(result).toEqual([
      { type: "tool_use", id: "call_0", name: "read_file", input: { path: "a.txt" } },
      { type: "tool_use", id: "call_1", name: "read_file", input: { path: "b.txt" } },
      { type: "stop", reason: "tool_use" },
    ]);
  });

  it("(d) finishReason MAX_TOKENS → stop max_tokens", async () => {
    const events = asyncOf({
      candidates: [
        {
          content: { parts: [{ text: "truncated" }] },
          finishReason: "MAX_TOKENS",
        },
      ],
    });
    const result = await collect(mapGeminiSSE(events));
    expect(result).toEqual([
      { type: "text_delta", text: "truncated" },
      { type: "stop", reason: "max_tokens" },
    ]);
  });
});
