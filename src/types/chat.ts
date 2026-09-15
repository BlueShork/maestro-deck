// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type ChatRole = "user" | "assistant" | "system";

export interface ImagePart {
  kind: "image";
  mediaType: "image/png";
  base64: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      /** Tool name (Gemini's functionResponse requires it). */
      name: string;
      content: string | ImagePart;
      isError?: boolean;
    };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string | ContentBlock[];
  createdAt: number;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema object (OpenAPI-compatible subset: type/properties/required/enum). */
  inputSchema: Record<string, unknown>;
}

export type ProviderEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "stop"; reason: "end_turn" | "tool_use" | "max_tokens" };

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
