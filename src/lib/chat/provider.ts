// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ChatMessage, ModelInfo, ProviderId, ProviderEvent, ToolSpec } from "@/types/chat";

export interface ChatProvider {
  readonly id: ProviderId;
  listModels(): ModelInfo[];
  stream(args: {
    model: string;
    messages: ChatMessage[];
    tools: ToolSpec[];
    signal: AbortSignal;
  }): AsyncIterable<ProviderEvent>;
}
