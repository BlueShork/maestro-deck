// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { invoke } from "@tauri-apps/api/core";

import type { ChatMessage, ProviderEvent, ToolSpec } from "@/types/chat";

import { mapAnthropicSSE, toAnthropicBody } from "./anthropicSerde";
import { mapGeminiSSE, toGeminiBody } from "./geminiSerde";
import { modelsByProvider } from "./models";
import type { ChatProvider } from "./provider";
import { readSSE } from "./sse";

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
    tools,
    signal,
  }: {
    model: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
  }): AsyncIterable<ProviderEvent> {
    const token = await this.accessToken();
    const isAnthropic = model.startsWith("claude-");
    const publisher = isAnthropic ? "anthropic" : "google";
    const endpoint = isAnthropic ? "streamRawPredict" : "streamGenerateContent?alt=sse";

    const url =
      `https://${this.region}-aiplatform.googleapis.com/v1/projects/${this.projectId}` +
      `/locations/${this.region}/publishers/${publisher}/models/${model}:${endpoint}`;

    // cache_control marks the system block as cacheable on Vertex
    // (same semantics as the direct Anthropic API). Implicit cache
    // already covers Gemini, so toGeminiBody needs no marker.
    const body = isAnthropic
      ? toAnthropicBody(messages, tools, { vertex: true })
      : toGeminiBody(messages, tools);

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
      yield* mapAnthropicSSE(readSSE(resp.body));
    } else {
      yield* mapGeminiSSE(readSSE(resp.body));
    }
  }
}
