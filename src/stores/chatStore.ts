import { create } from "zustand";

import { getProvider } from "@/lib/chat/registry";
import type { ChatMessage, ProviderId } from "@/types/chat";

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  currentProvider: ProviderId;
  currentModel: string;
  error: string | null;

  abort: AbortController | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setProvider: (provider: ProviderId, model: string) => void;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
}

const DEFAULTS = {
  provider: "anthropic" as ProviderId,
  model: "claude-sonnet-4-6",
};

export const useChatStore = create<ChatState>((set, get) => ({
  isOpen: false,
  messages: [],
  isStreaming: false,
  currentProvider: DEFAULTS.provider,
  currentModel: DEFAULTS.model,
  error: null,
  abort: null,

  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  setOpen: (open) => set({ isOpen: open }),

  setProvider: (provider, model) =>
    set({ currentProvider: provider, currentModel: model, error: null }),

  sendMessage: async (text) => {
    const trimmed = text.trim();
    if (!trimmed || get().isStreaming) return;

    const provider = await getProvider(get().currentProvider);
    if (!provider) {
      set({ error: "No credentials configured for this provider. Open Settings to add them." });
      return;
    }

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const assistantPlaceholder: ChatMessage = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
    };

    const abort = new AbortController();
    set((s) => ({
      messages: [...s.messages, userMsg, assistantPlaceholder],
      isStreaming: true,
      error: null,
      abort,
    }));

    try {
      const stream = provider.stream({
        model: get().currentModel,
        messages: [...get().messages.filter((m) => m.id !== assistantId)],
        signal: abort.signal,
      });

      for await (const delta of stream) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + delta } : m,
          ),
        }));
      }
    } catch (err) {
      if (abort.signal.aborted) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? { ...m, content: m.content + "\n\n_[stopped]_" }
              : m,
          ),
        }));
      } else {
        const message = err instanceof Error ? err.message : String(err);
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== assistantId),
          error: message,
        }));
      }
    } finally {
      set({ isStreaming: false, abort: null });
    }
  },

  cancel: () => {
    get().abort?.abort();
  },

  clear: () => set({ messages: [], error: null }),
}));
