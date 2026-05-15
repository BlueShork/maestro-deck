// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export type ProviderId = "anthropic" | "vertex";

export interface AnthropicCredentials {
  apiKey: string;
}

export interface VertexCredentials {
  projectId: string;
  region: string;
  serviceAccountJson: string;
}

export interface ModelInfo {
  id: string;
  label: string;
  provider: ProviderId;
  contextWindow: number;
}
