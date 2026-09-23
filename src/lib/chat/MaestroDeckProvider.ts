// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { CLOUD_DASHBOARD_URL, getCloudIdToken } from "@/lib/cloudAuth";
import type { ChatMessage, ProviderEvent, ToolSpec } from "@/types/chat";

import { MAESTRODECK_MODEL } from "./models";
import { mapMistralSSE, toMistralBody } from "./mistralSerde";
import type { ChatProvider } from "./provider";
import { readSSE } from "./sse";

/**
 * Billy served by Maestro Deck Cloud (same assistant as the iOS app), free for
 * any signed-in account. The server holds the model key and forwards the
 * conversation; tools still run here, in the agent loop, like any provider.
 */
export class MaestroDeckProvider implements ChatProvider {
  readonly id = "maestrodeck" as const;

  listModels() {
    return [MAESTRODECK_MODEL];
  }

  async *stream({
    messages,
    tools,
    signal,
  }: {
    model: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
  }): AsyncIterable<ProviderEvent> {
    const token = await getCloudIdToken();

    let resp: Response;
    try {
      resp = await fetch(`${CLOUD_DASHBOARD_URL}/api/assistant/agent`, {
        method: "POST",
        signal,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(toMistralBody(messages, tools)),
      });
    } catch (err) {
      if (signal.aborted) throw err;
      // WebKit's own wording ("Load failed") tells the user nothing.
      throw new Error("Could not reach Maestro Deck Cloud. Check your connection and try again.", {
        cause: err,
      });
    }

    if (!resp.ok || !resp.body) {
      if (resp.status === 401) {
        throw new Error("Your Maestro Deck session expired — sign out and back in.");
      }
      const body = (await resp.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Billy couldn't answer right now (HTTP ${resp.status}).`);
    }

    yield* mapMistralSSE(readSSE(resp.body));
  }
}
