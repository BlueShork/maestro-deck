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
  /** A user question that came in by voice (shows a mic badge). */
  viaVoice?: boolean;
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

/** Providers the user brings their own key for (stored in the OS keychain). */
export type ByokProviderId = "anthropic" | "vertex";

/** `maestrodeck` is Billy served by Maestro Deck Cloud, on the user's account. */
export type ProviderId = "maestrodeck" | ByokProviderId;

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
