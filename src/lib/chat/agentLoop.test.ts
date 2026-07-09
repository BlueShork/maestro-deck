// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it, vi } from "vitest";

import type { ChatMessage, ContentBlock, ProviderEvent, ToolSpec } from "@/types/chat";

import { MAX_TOOL_TURNS, runAgentLoop } from "./agentLoop";

// ---------------------------------------------------------------------------
// Mock provider
// ---------------------------------------------------------------------------

interface ProviderCall {
  messages: ChatMessage[];
  tools: ToolSpec[];
}

function makeMockProvider(eventQueues: ProviderEvent[][]) {
  const calls: ProviderCall[] = [];
  let callIndex = 0;
  return {
    calls,
    provider: {
      id: "anthropic" as const,
      listModels: () => [],
      stream(args: { messages: ChatMessage[]; tools: ToolSpec[] }): AsyncIterable<ProviderEvent> {
        calls.push({ messages: [...args.messages], tools: [...args.tools] });
        const events = eventQueues[callIndex++] ?? [];
        return (async function* () {
          for (const e of events) yield e;
        })();
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOOLS: ToolSpec[] = [{ name: "tap", description: "tap", inputSchema: {} }];

function makeSignal(aborted = false): AbortSignal {
  const ctrl = new AbortController();
  if (aborted) ctrl.abort();
  return ctrl.signal;
}

const msg = (content: ChatMessage["content"]): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  content,
  createdAt: 0,
});

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runAgentLoop", () => {
  const baseArgs = {
    model: "claude-3-5-sonnet",
    tools: TOOLS,
    messages: [msg("hello")],
  };

  // 1. text-only turn
  it("text-only turn: yields text_deltas, one provider call, generator ends", async () => {
    const { provider, calls } = makeMockProvider([
      [
        { type: "text_delta", text: "Hello " },
        { type: "text_delta", text: "world" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);
    const execute = vi.fn();
    const events = await collect(
      runAgentLoop({ ...baseArgs, provider, signal: makeSignal(), execute }),
    );

    expect(calls).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: "text_delta", text: "Hello " },
      { type: "text_delta", text: "world" },
    ]);
  });

  // 2. tool turn then final text
  it("tool turn then final text: execute called, second call has combined assistant message", async () => {
    const toolId = "tu_1";
    const { provider, calls } = makeMockProvider([
      [
        { type: "tool_use", id: toolId, name: "tap", input: { x: 1, y: 2 } },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "done" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const execute = vi.fn().mockResolvedValue({ content: "tapped", isError: false });

    const events = await collect(
      runAgentLoop({ ...baseArgs, provider, signal: makeSignal(), execute }),
    );

    // execute was called with name + input
    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith("tap", { x: 1, y: 2 });

    // tool_result event yielded
    const trEvent = events.find((e) => e.type === "tool_result");
    expect(trEvent).toBeDefined();

    // second provider call's last message is the combined assistant message
    expect(calls).toHaveLength(2);
    const lastMsg = calls[1].messages.at(-1)!;
    expect(lastMsg.role).toBe("assistant");
    const blocks = lastMsg.content as ContentBlock[];
    expect(blocks.some((b) => b.type === "tool_use")).toBe(true);
    expect(blocks.some((b) => b.type === "tool_result")).toBe(true);
  });

  // 3. execute returning isError:true
  it("execute returning isError:true produces tool_result with isError and loop continues", async () => {
    const toolId = "tu_err";
    const { provider } = makeMockProvider([
      [
        { type: "tool_use", id: toolId, name: "tap", input: {} },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "sorry" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const execute = vi.fn().mockResolvedValue({ content: "boom", isError: true });

    const events = await collect(
      runAgentLoop({ ...baseArgs, provider, signal: makeSignal(), execute }),
    );

    const trEvent = events.find(
      (e): e is { type: "tool_result"; block: Extract<ContentBlock, { type: "tool_result" }> } =>
        e.type === "tool_result",
    );
    expect(trEvent?.block.isError).toBe(true);
    // Loop continued: text_delta from second turn
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
  });

  // 4. abort after first tool_use
  it("abort after first tool_use: no second provider call", async () => {
    const ctrl = new AbortController();
    const toolId = "tu_abort";
    const { provider, calls } = makeMockProvider([
      [
        { type: "tool_use", id: toolId, name: "tap", input: {} },
        { type: "stop", reason: "tool_use" },
      ],
      [
        { type: "text_delta", text: "never" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const execute = vi.fn().mockImplementation(async () => {
      ctrl.abort();
      return { content: "ok", isError: false };
    });

    await collect(runAgentLoop({ ...baseArgs, provider, signal: ctrl.signal, execute }));

    expect(calls).toHaveLength(1);
  });

  // 5. turn cap: 25 executions then turn_limit
  it("turn cap: after 25 tool executions yields turn_limit and ends", async () => {
    const makeToolTurn = (id: string): ProviderEvent[] => [
      { type: "tool_use", id, name: "tap", input: {} },
      { type: "stop", reason: "tool_use" },
    ];
    // 26 queued turns so the 26th would be used if cap not enforced
    const queues = Array.from({ length: 26 }, (_, i) => makeToolTurn(`tu_${i}`));
    const { provider } = makeMockProvider(queues);

    const execute = vi.fn().mockResolvedValue({ content: "ok", isError: false });

    const events = await collect(
      runAgentLoop({ ...baseArgs, provider, signal: makeSignal(), execute }),
    );

    expect(execute).toHaveBeenCalledTimes(MAX_TOOL_TURNS);
    expect(events.at(-1)).toEqual({ type: "turn_limit" });
  });

  // 6. truncateToolResults applied before sending to provider
  it("old tool_results are truncated in later provider calls", async () => {
    // Build an initial messages array with 5 tool_result blocks so the first one
    // is old enough to be truncated.
    const big = "x".repeat(3000);
    const trBlock = (id: string): ContentBlock => ({
      type: "tool_result",
      toolUseId: id,
      name: "tap",
      content: big,
    });
    const assistantWithResults: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: [trBlock("old1"), trBlock("old2"), trBlock("r3"), trBlock("r4"), trBlock("r5")],
      createdAt: 0,
    };

    const messages: ChatMessage[] = [msg("hi"), assistantWithResults];

    const { provider, calls } = makeMockProvider([
      [
        { type: "text_delta", text: "hi" },
        { type: "stop", reason: "end_turn" },
      ],
    ]);

    const execute = vi.fn();
    await collect(runAgentLoop({ ...baseArgs, messages, provider, signal: makeSignal(), execute }));

    expect(calls).toHaveLength(1);
    const sentMsgs = calls[0].messages;
    const assistantSent = sentMsgs.find((m) => m.role === "assistant")!;
    const blocks = assistantSent.content as ContentBlock[];
    // The first block (old1) should have been truncated
    const first = blocks[0] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(first.content.toString().length).toBeLessThan(2100);
    expect(first.content.toString().endsWith("… [truncated]")).toBe(true);
    // The 4 most recent (old2, r3, r4, r5) should be intact
    const second = blocks[1] as Extract<ContentBlock, { type: "tool_result" }>;
    expect(second.content).toBe(big);
  });
});
