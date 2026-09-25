// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import type { ChatMessage, ProviderEvent, ToolSpec } from "@/types/chat";

import { mapMistralSSE, mistralToolCallId, toMistralBody } from "./mistralSerde";

type Body = { messages: Record<string, unknown>[]; tools: Record<string, unknown>[] };

const msg = (role: ChatMessage["role"], content: ChatMessage["content"]): ChatMessage => ({
  id: crypto.randomUUID(),
  role,
  content,
  createdAt: 0,
});

async function collect(events: unknown[]): Promise<ProviderEvent[]> {
  async function* gen() {
    yield* events;
  }
  const out: ProviderEvent[] = [];
  for await (const e of mapMistralSSE(gen())) out.push(e);
  return out;
}

describe("mistralToolCallId", () => {
  it("keeps Mistral's own ids", () => {
    expect(mistralToolCallId("aB3dE5gH9")).toBe("aB3dE5gH9");
  });

  it("maps any other id to a stable 9-char alphanumeric id", () => {
    const id = mistralToolCallId("toolu_01ABCdefGHI");
    expect(id).toMatch(/^[A-Za-z0-9]{9}$/);
    expect(mistralToolCallId("toolu_01ABCdefGHI")).toBe(id);
    expect(mistralToolCallId("toolu_01ABCdefGHJ")).not.toBe(id);
  });
});

describe("toMistralBody", () => {
  const tools: ToolSpec[] = [
    { name: "get_screen", description: "Read the screen", inputSchema: { type: "object" } },
  ];

  it("keeps system turns first and maps tools to functions", () => {
    const body = toMistralBody(
      [msg("system", "prompt"), msg("system", "context"), msg("user", "Hi")],
      tools,
    ) as Body;
    expect(body.messages).toEqual([
      { role: "system", content: "prompt" },
      { role: "system", content: "context" },
      { role: "user", content: "Hi" },
    ]);
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_screen",
          description: "Read the screen",
          parameters: { type: "object" },
        },
      },
    ]);
  });

  it("splits an interleaved assistant message into assistant and tool turns", () => {
    const body = toMistralBody(
      [
        msg("user", "Tap login"),
        msg("assistant", [
          { type: "text", text: "Looking." },
          { type: "tool_use", id: "abcdefghi", name: "tap", input: { x: 1 } },
          { type: "tool_result", toolUseId: "abcdefghi", name: "tap", content: "ok" },
          { type: "text", text: "Done." },
        ]),
      ],
      [],
    ) as Body;
    expect(body.messages.slice(1)).toEqual([
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [
          { id: "abcdefghi", type: "function", function: { name: "tap", arguments: '{"x":1}' } },
        ],
      },
      { role: "tool", tool_call_id: "abcdefghi", name: "tap", content: "ok" },
      { role: "assistant", content: "Done." },
    ]);
  });

  it("sends a screenshot in a user turn behind an assistant line, never after a tool turn", () => {
    const body = toMistralBody(
      [
        msg("user", "What's on screen?"),
        msg("assistant", [
          { type: "tool_use", id: "shot12345", name: "take_screenshot", input: {} },
          {
            type: "tool_result",
            toolUseId: "shot12345",
            name: "take_screenshot",
            content: { kind: "image", mediaType: "image/png", base64: "AAAA" },
          },
        ]),
      ],
      [],
    ) as Body;
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant", "user"]);
    expect(body.messages[4].content).toEqual([
      {
        type: "text",
        text: "The current screen of the connected device, as returned by take_screenshot:",
      },
      { type: "image_url", image_url: "data:image/png;base64,AAAA" },
    ]);
  });

  it("keeps only the 4 most recent screenshots", () => {
    const shot = (n: number) =>
      msg("assistant", [
        { type: "tool_use", id: `shot${n}`, name: "take_screenshot", input: {} },
        {
          type: "tool_result",
          toolUseId: `shot${n}`,
          name: "take_screenshot",
          content: { kind: "image", mediaType: "image/png", base64: `IMG${n}` },
        },
      ]);
    const body = toMistralBody(
      [msg("user", "Go"), shot(1), shot(2), shot(3), shot(4), shot(5), shot(6)],
      [],
    ) as Body;
    const images = body.messages
      .filter((m) => m.role === "user" && Array.isArray(m.content))
      .flatMap((m) => m.content as { type: string; image_url?: string }[])
      .filter((p) => p.type === "image_url")
      .map((p) => p.image_url);
    expect(images).toEqual([3, 4, 5, 6].map((n) => `data:image/png;base64,IMG${n}`));
  });

  it("drops a tool call left without a result", () => {
    const body = toMistralBody(
      [
        msg("user", "Run it"),
        msg("assistant", [
          { type: "text", text: "Running." },
          { type: "tool_use", id: "run123456", name: "run_flow", input: {} },
          { type: "text", text: "\n\n_[stopped]_" },
        ]),
        msg("user", "Never mind"),
      ],
      [],
    ) as Body;
    expect(body.messages.slice(1)).toEqual([
      { role: "assistant", content: "Running.\n\n_[stopped]_" },
      { role: "user", content: "Never mind" },
    ]);
  });

  it("skips empty turns", () => {
    const body = toMistralBody([msg("user", "Hi"), msg("assistant", "")], []) as Body;
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });
});

describe("mapMistralSSE", () => {
  it("streams text and ends the turn", async () => {
    const events = await collect([
      { choices: [{ delta: { role: "assistant", content: "" } }] },
      { choices: [{ delta: { content: "Hel" } }] },
      { choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] },
    ]);
    expect(events).toEqual([
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo" },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("emits whole tool calls (Mistral) and streamed ones (OpenAI style)", async () => {
    const events = await collect([
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { id: "abcdefghi", index: 0, function: { name: "tap", arguments: '{"x":1}' } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [{ id: "jklmnopqr", index: 1, function: { name: "get_screen" } }],
            },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{"a"' } }] } }] },
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 1, function: { arguments: ":2}" } }] },
            finish_reason: "tool_calls",
          },
        ],
      },
    ]);
    expect(events).toEqual([
      { type: "tool_use", id: "abcdefghi", name: "tap", input: { x: 1 } },
      { type: "tool_use", id: "jklmnopqr", name: "get_screen", input: { a: 2 } },
      { type: "stop", reason: "tool_use" },
    ]);
  });

  it("accepts arguments sent as an object and reports max_tokens", async () => {
    const withObject = await collect([
      {
        choices: [
          {
            delta: {
              tool_calls: [{ id: "abcdefghi", function: { name: "tap", arguments: { x: 3 } } }],
            },
          },
        ],
      },
    ]);
    expect(withObject[0]).toEqual({
      type: "tool_use",
      id: "abcdefghi",
      name: "tap",
      input: { x: 3 },
    });

    const cut = await collect([
      { choices: [{ delta: { content: "…" }, finish_reason: "length" }] },
    ]);
    expect(cut.at(-1)).toEqual({ type: "stop", reason: "max_tokens" });
  });
});
