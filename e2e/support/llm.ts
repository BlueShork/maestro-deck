// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { Page, Route } from "@playwright/test";

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type Turn =
  | { text?: string; tools?: ToolCall[] }
  | { status: number; body: string }
  | "hang";

export interface FakeServer {
  requests: () => Array<Record<string, unknown>>;
}

const sse = (events: unknown[]) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");

const halves = (s: string) => [
  s.slice(0, Math.ceil(s.length / 2)),
  s.slice(Math.ceil(s.length / 2)),
];

function anthropicStream(turn: { text?: string; tools?: ToolCall[] }): string {
  const events: unknown[] = [{ type: "message_start", message: { id: "msg_1" } }];
  let index = 0;
  if (turn.text) {
    events.push({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    for (const t of halves(turn.text)) {
      events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text: t } });
    }
    events.push({ type: "content_block_stop", index });
    index++;
  }
  for (const call of turn.tools ?? []) {
    events.push({
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
    });
    for (const j of halves(JSON.stringify(call.input))) {
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "input_json_delta", partial_json: j },
      });
    }
    events.push({ type: "content_block_stop", index });
    index++;
  }
  events.push({
    type: "message_delta",
    delta: { stop_reason: turn.tools?.length ? "tool_use" : "end_turn" },
  });
  events.push({ type: "message_stop" });
  return sse(events);
}

function mistralStream(turn: { text?: string; tools?: ToolCall[] }): string {
  const events: unknown[] = [];
  for (const t of turn.text ? halves(turn.text) : []) {
    events.push({ choices: [{ delta: { content: t }, finish_reason: null }] });
  }
  (turn.tools ?? []).forEach((call, i) => {
    events.push({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: i,
                id: call.id,
                function: { name: call.name, arguments: JSON.stringify(call.input) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    });
  });
  events.push({
    choices: [{ delta: {}, finish_reason: turn.tools?.length ? "tool_calls" : "stop" }],
  });
  return `${sse(events)}data: [DONE]\n\n`;
}

async function serve(
  page: Page,
  url: string,
  turns: Turn[],
  render: (t: { text?: string; tools?: ToolCall[] }) => string,
): Promise<FakeServer> {
  const requests: Array<Record<string, unknown>> = [];
  const queue = [...turns];
  await page.route(url, async (route: Route) => {
    if (route.request().method() !== "POST") return route.fallback();
    requests.push(route.request().postDataJSON() as Record<string, unknown>);
    const turn = queue.shift() ?? { text: "(no more scripted turns)" };
    if (turn === "hang") return;
    if ("status" in turn) {
      await route.fulfill({
        status: turn.status,
        body: turn.body,
        contentType: "application/json",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream", "access-control-allow-origin": "*" },
      body: render(turn),
    });
  });
  return { requests: () => requests };
}

export const fakeAnthropic = (page: Page, turns: Turn[]) =>
  serve(page, "https://api.anthropic.com/v1/messages", turns, anthropicStream);

export const fakeHostedBilly = (page: Page, turns: Turn[]) =>
  serve(page, "https://dashboard.maestrodeck.cloud/api/assistant/agent", turns, mistralStream);

export const withAnthropic = {
  credentials: { anthropic: JSON.stringify({ apiKey: "sk-ant-test" }) },
  storage: {
    "maestro-deck.chat": JSON.stringify({
      state: { currentProvider: "anthropic", currentModel: "claude-sonnet-4-5" },
      version: 0,
    }),
  },
};
