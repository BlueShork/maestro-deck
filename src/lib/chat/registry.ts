// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { isCloudSignedIn } from "@/lib/cloudAuth";
import type { ProviderId } from "@/types/chat";

import { AnthropicProvider } from "./AnthropicProvider";
import { MaestroDeckProvider } from "./MaestroDeckProvider";
import { VertexProvider } from "./VertexProvider";
import { credentials } from "./credentials";
import type { ChatProvider } from "./provider";

const cache = new Map<ProviderId, ChatProvider>();

export async function getProvider(id: ProviderId): Promise<ChatProvider | null> {
  // No credentials to cache: the account is the credential, checked each time
  // so signing out takes effect on the next message.
  if (id === "maestrodeck") return isCloudSignedIn() ? new MaestroDeckProvider() : null;

  if (cache.has(id)) return cache.get(id)!;

  if (id === "anthropic") {
    const creds = await credentials.getAnthropic();
    if (!creds?.apiKey) return null;
    const p = new AnthropicProvider(creds.apiKey);
    cache.set("anthropic", p);
    return p;
  }

  const creds = await credentials.getVertex();
  if (!creds?.serviceAccountJson || !creds.projectId || !creds.region) return null;
  const p = new VertexProvider(creds.projectId, creds.region, creds.serviceAccountJson);
  cache.set("vertex", p);
  return p;
}

export function invalidateProvider(id: ProviderId) {
  cache.delete(id);
}
