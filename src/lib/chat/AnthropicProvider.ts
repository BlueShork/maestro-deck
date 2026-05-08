import type { ChatMessage } from "@/types/chat";

import { modelsByProvider } from "./models";
import type { ChatProvider } from "./provider";
import { readSSE } from "./sse";

interface AnthropicEvent {
  type: string;
  delta?: { type?: string; text?: string };
}

function buildSystemBlocks(messages: ChatMessage[]) {
  const text = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  if (!text) return undefined;
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
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
        // Mark the system prompt as cacheable — Anthropic hashes it and on
        // subsequent requests within ~5 min reads from the cache, billing
        // that portion at ~10% of the input rate. Requires the prompt to
        // be ≥1024 tokens (Sonnet/Opus) or ≥2048 (Haiku); below that the
        // marker is ignored, no harm done.
        system: buildSystemBlocks(messages),
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
      if (
        evt.type === "content_block_delta" &&
        evt.delta?.type === "text_delta" &&
        evt.delta.text
      ) {
        yield evt.delta.text;
      }
    }
  }
}
