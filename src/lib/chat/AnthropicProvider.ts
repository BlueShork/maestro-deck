// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ChatMessage, ProviderEvent, ToolSpec } from "@/types/chat";

import { mapAnthropicSSE, toAnthropicBody } from "./anthropicSerde";
import { modelsByProvider } from "./models";
import type { ChatProvider } from "./provider";
import { readSSE } from "./sse";

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic" as const;

  constructor(private apiKey: string) {}

  listModels() {
    return modelsByProvider("anthropic");
  }

  async *stream({
    model,
    messages,
    tools,
    signal,
  }: {
    model: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
  }): AsyncIterable<ProviderEvent> {
    const body = {
      model,
      ...toAnthropicBody(messages, tools, { vertex: false }),
    };

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        // Required when calling the API directly from a browser/webview.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Anthropic ${resp.status}: ${detail || resp.statusText}`);
    }

    yield* mapAnthropicSSE(readSSE(resp.body));
  }
}
