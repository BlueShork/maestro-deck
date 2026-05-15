// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { invoke } from "@tauri-apps/api/core";

import type { AnthropicCredentials, ProviderId, VertexCredentials } from "@/types/chat";

/**
 * Credential store backed by the OS keychain (macOS Keychain Services,
 * Windows Credential Manager, Linux Secret Service).
 *
 * Each credential is stored as a JSON string under the service name
 * `com.maestro-deck.chat`, account = provider id. The user can audit and
 * revoke them at any time from their OS-level keychain UI.
 */

async function readJson<T>(provider: ProviderId): Promise<T | null> {
  const value = await invoke<string | null>("get_credential", { provider });
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function writeJson<T>(provider: ProviderId, value: T): Promise<void> {
  await invoke("save_credential", { provider, payload: JSON.stringify(value) });
}

export const credentials = {
  async saveAnthropic(creds: AnthropicCredentials) {
    await writeJson("anthropic", creds);
  },
  async getAnthropic() {
    return readJson<AnthropicCredentials>("anthropic");
  },
  async saveVertex(creds: VertexCredentials) {
    await writeJson("vertex", creds);
  },
  async getVertex() {
    return readJson<VertexCredentials>("vertex");
  },
  async clear(provider: ProviderId) {
    await invoke("delete_credential", { provider });
  },
};
