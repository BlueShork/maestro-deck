import type { ChatMessage, ModelInfo, ProviderId } from "@/types/chat";

export interface ChatProvider {
  readonly id: ProviderId;
  listModels(): ModelInfo[];
  stream(args: {
    model: string;
    messages: ChatMessage[];
    signal: AbortSignal;
  }): AsyncIterable<string>;
}
