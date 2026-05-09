import { invoke } from "@tauri-apps/api/core";

import type { ChatMessage } from "@/types/chat";

import { modelsByProvider } from "./models";
import type { ChatProvider } from "./provider";
import { readSSE } from "./sse";

interface AnthropicVertexEvent {
  type: string;
  delta?: { type?: string; text?: string };
}

interface GeminiCandidate {
  content?: { parts?: { text?: string }[] };
}
interface GeminiEvent {
  candidates?: GeminiCandidate[];
}

export class VertexProvider implements ChatProvider {
  readonly id = "vertex" as const;

  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private projectId: string,
    private region: string,
    private serviceAccountJson: string,
  ) {}

  listModels() {
    return modelsByProvider("vertex");
  }

  private async accessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) {
      return this.cachedToken.value;
    }
    const [value, expiresIn] = await invoke<[string, number]>("vertex_get_access_token", {
      serviceAccountJson: this.serviceAccountJson,
    });
    this.cachedToken = { value, expiresAt: Date.now() + expiresIn * 1000 };
    return value;
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
    const token = await this.accessToken();
    const isAnthropic = model.startsWith("claude-");
    const publisher = isAnthropic ? "anthropic" : "google";
    const endpoint = isAnthropic ? "streamRawPredict" : "streamGenerateContent?alt=sse";

    const url =
      `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}` +
      `/locations/${this.region}/publishers/${publisher}/models/${model}:${endpoint}`;

    const systemPrompt = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const body = isAnthropic
      ? {
          anthropic_version: "vertex-2023-10-16",
          stream: true,
          max_tokens: 4096,
          // cache_control marks the system block as cacheable on Vertex
          // (same semantics as the direct Anthropic API). Implicit cache
          // already covers Gemini, so the else-branch needs no marker.
          system: systemPrompt
            ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
            : undefined,
          messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
        }
      : {
          systemInstruction: systemPrompt
            ? { role: "system", parts: [{ text: systemPrompt }] }
            : undefined,
          contents: nonSystem.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        };

    const resp = await fetch(url, {
      method: "POST",
      signal,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Vertex ${resp.status}: ${detail || resp.statusText}`);
    }

    if (isAnthropic) {
      for await (const evt of readSSE(resp.body) as AsyncIterable<AnthropicVertexEvent>) {
        if (
          evt.type === "content_block_delta" &&
          evt.delta?.type === "text_delta" &&
          evt.delta.text
        ) {
          yield evt.delta.text;
        }
      }
    } else {
      for await (const evt of readSSE(resp.body) as AsyncIterable<GeminiEvent>) {
        const text = evt.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) yield text;
      }
    }
  }
}
