// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import type { ChatMessage, ProviderEvent, ToolSpec } from "@/types/chat";

import { mapAnthropicSSE, toAnthropicBody } from "./anthropicSerde";

// ---------------------------------------------------------------------------
// toAnthropicBody
// ---------------------------------------------------------------------------

describe("toAnthropicBody", () => {
  const tools: ToolSpec[] = [
    {
      name: "read_file",
      description: "Read a file",
      inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    },
  ];

  it("maps system messages to system blocks with cache_control", () => {
    const messages: ChatMessage[] = [
      { id: "s", role: "system", content: "You are helpful.", createdAt: 0 },
      { id: "u", role: "user", content: "Hello", createdAt: 1 },
    ];
    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    expect(body.system).toEqual([
      { type: "text", text: "You are helpful.", cache_control: { type: "ephemeral" } },
    ]);
    expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("omits system key when no system messages", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Hi", createdAt: 0 }];
    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    expect(body.system).toBeUndefined();
  });

  it("splits interleaved assistant blocks into alternating assistant/user turns", () => {
    // One assistant message containing: text, tool_use, tool_result, text, tool_use, tool_result
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "tu1", name: "read_file", input: { path: "foo.txt" } },
          {
            type: "tool_result",
            toolUseId: "tu1",
            name: "read_file",
            content: "file content",
            isError: false,
          },
          { type: "text", text: "Also this." },
          { type: "tool_use", id: "tu2", name: "read_file", input: { path: "bar.txt" } },
          {
            type: "tool_result",
            toolUseId: "tu2",
            name: "read_file",
            content: "more content",
            isError: false,
          },
        ],
        createdAt: 1,
      },
    ];
    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    const turns = body.messages as Array<{ role: string; content: unknown }>;
    // Expect 4 turns: assistant (text+tool_use), user (tool_result), assistant (text+tool_use), user (tool_result)
    expect(turns).toHaveLength(4);
    expect(turns[0].role).toBe("assistant");
    expect(turns[0].content).toEqual([
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "tu1", name: "read_file", input: { path: "foo.txt" } },
    ]);
    expect(turns[1].role).toBe("user");
    expect(turns[1].content).toEqual([
      { type: "tool_result", tool_use_id: "tu1", content: "file content", is_error: false },
    ]);
    expect(turns[2].role).toBe("assistant");
    expect(turns[2].content).toEqual([
      { type: "text", text: "Also this." },
      { type: "tool_use", id: "tu2", name: "read_file", input: { path: "bar.txt" } },
    ]);
    expect(turns[3].role).toBe("user");
    expect(turns[3].content).toEqual([
      { type: "tool_result", tool_use_id: "tu2", content: "more content", is_error: false },
    ]);
  });

  it("serializes image tool_result content as base64 image block", () => {
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: [
          { type: "tool_use", id: "tu1", name: "screenshot", input: {} },
          {
            type: "tool_result",
            toolUseId: "tu1",
            name: "screenshot",
            content: { kind: "image", mediaType: "image/png", base64: "abc123" },
          },
        ],
        createdAt: 1,
      },
    ];
    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    const turns = body.messages as Array<{ role: string; content: unknown[] }>;
    expect(turns[1].content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "tu1",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: "abc123" } },
        ],
        is_error: undefined,
      },
    ]);
  });

  it("includes tools as name/description/input_schema", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Go", createdAt: 0 }];
    const body = toAnthropicBody(messages, tools, { vertex: false }) as Record<string, unknown>;
    expect(body.tools).toEqual([
      {
        name: "read_file",
        description: "Read a file",
        input_schema: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ]);
  });

  it("omits tools key entirely when tools is empty", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Go", createdAt: 0 }];
    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    expect(body.tools).toBeUndefined();
  });

  it("includes anthropic_version and omits model when vertex:true", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Go", createdAt: 0 }];
    const body = toAnthropicBody(messages, [], { vertex: true }) as Record<string, unknown>;
    expect(body.anthropic_version).toBe("vertex-2023-10-16");
    expect("model" in body).toBe(false);
  });

  it("does not include anthropic_version when vertex:false", () => {
    const messages: ChatMessage[] = [{ id: "u", role: "user", content: "Go", createdAt: 0 }];
    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    expect("anthropic_version" in body).toBe(false);
  });

  it("merges adjacent same-role turns: tool_result user turn followed by next user message produces a single user turn", () => {
    // Simulate a persisted assistant block ending in tool_result (which serializes to a
    // trailing `user` turn), followed by a plain user string message — the classic
    // consecutive same-role scenario.
    const messages: ChatMessage[] = [
      {
        id: "a",
        role: "assistant",
        content: [
          { type: "text", text: "Running the flow." },
          { type: "tool_use", id: "tu1", name: "run_flow", input: { path: "test.yaml" } },
          {
            type: "tool_result",
            toolUseId: "tu1",
            name: "run_flow",
            content: '{"exitCode":0,"stoppedByUser":false,"tail":""}',
            isError: false,
          },
        ],
        createdAt: 1,
      },
      // This plain user message comes from the NEXT send — would be a second `user` turn
      // without merging.
      { id: "u2", role: "user", content: "Great, now run the next flow.", createdAt: 2 },
    ];

    const body = toAnthropicBody(messages, [], { vertex: false }) as Record<string, unknown>;
    const turns = body.messages as Array<{ role: string; content: unknown[] }>;

    // Should be: assistant (text+tool_use), user (tool_result + new text) — NO adjacent user turns
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("assistant");
    expect(turns[1].role).toBe("user");

    // The merged user turn must contain both the tool_result block AND the new user text
    const userContent = turns[1].content;
    const hasToolResult = userContent.some(
      (c) => (c as Record<string, unknown>).type === "tool_result",
    );
    const hasUserText = userContent.some(
      (c) =>
        (c as Record<string, unknown>).type === "text" &&
        (c as Record<string, unknown>).text === "Great, now run the next flow.",
    );
    expect(hasToolResult).toBe(true);
    expect(hasUserText).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// mapAnthropicSSE
// ---------------------------------------------------------------------------

async function collect(gen: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const results: ProviderEvent[] = [];
  for await (const evt of gen) results.push(evt);
  return results;
}

async function* asyncOf<T>(...items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

describe("mapAnthropicSSE", () => {
  it("(a) plain text stream ending end_turn", async () => {
    const events = asyncOf(
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    );

    const result = await collect(mapAnthropicSSE(events));
    expect(result).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " world" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("(b) tool_use block with 2 input_json_delta chunks then tool_use stop_reason", async () => {
    const events = asyncOf(
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_01", name: "read_file" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '{"path":' },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: '"foo.txt"}' },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" } },
      { type: "message_stop" },
    );

    const result = await collect(mapAnthropicSSE(events));
    expect(result).toEqual([
      { type: "tool_use", id: "toolu_01", name: "read_file", input: { path: "foo.txt" } },
      { type: "stop", reason: "tool_use" },
    ]);
  });

  it("(c) malformed accumulated JSON yields input: {}", async () => {
    const events = asyncOf(
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_02", name: "broken" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: "NOT VALID JSON" },
      },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" } },
      { type: "message_stop" },
    );

    const result = await collect(mapAnthropicSSE(events));
    expect(result).toEqual([
      { type: "tool_use", id: "toolu_02", name: "broken", input: {} },
      { type: "stop", reason: "end_turn" },
    ]);
  });
});
