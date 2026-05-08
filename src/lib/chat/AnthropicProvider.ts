import type { ChatMessage } from "@/types/chat";

import { modelsByProvider } from "./models";
import type { ChatProvider } from "./provider";
import { readSSE } from "./sse";

interface AnthropicEvent {
  type: string;
  delta?: { type?: string; text?: string };
}

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic" as const;

  constructor(private apiKey: string) {}

  listModels() {
    return modelsByProvider("anthropic");
  }

  async *stream({
    model,
    messages,
    signal,
  }: {
    model: string;
    messages: ChatMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string> {
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
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        messages: messages
          .filter((m) => m.role !== "system")
          .map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Anthropic ${resp.status}: ${detail || resp.statusText}`);
    }

    for await (const evt of readSSE(resp.body) as AsyncIterable<AnthropicEvent>) {
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta" && evt.delta.text) {
        yield evt.delta.text;
      }
    }
  }
}
