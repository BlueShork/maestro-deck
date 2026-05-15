// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { getProvider } from "@/lib/chat/registry";
import { BILLY_SYSTEM_PROMPT } from "@/lib/chat/systemPrompt";
import { useFlowStore } from "@/stores/flowStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types";
import type { ChatMessage, ProviderId } from "@/types/chat";

function listYamlPaths(node: WorkspaceNode | null, root: string | null): string[] {
  if (!node) return [];
  const out: string[] = [];
  const walk = (n: WorkspaceNode) => {
    if (n.kind === "file") {
      if (/\.ya?ml$/.test(n.name)) {
        const rel =
          root && n.path.startsWith(root)
            ? n.path.slice(root.length).replace(/^[/\\]/, "")
            : n.path;
        out.push(rel);
      }
      return;
    }
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out.sort();
}

interface ChatState {
  isOpen: boolean;
  messages: ChatMessage[];
  isStreaming: boolean;
  currentProvider: ProviderId;
  currentModel: string;
  error: string | null;

  abort: AbortController | null;

  /** Bumped whenever something needs MessageList to scroll to bottom
   *  (e.g. the input grew and consumed visible space). */
  scrollBump: number;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setProvider: (provider: ProviderId, model: string) => void;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
  clear: () => void;
  bumpScroll: () => void;
}

const DEFAULTS = {
  provider: "anthropic" as ProviderId,
  model: "claude-sonnet-4-6",
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      messages: [],
      isStreaming: false,
      currentProvider: DEFAULTS.provider,
      currentModel: DEFAULTS.model,
      error: null,
      abort: null,
      scrollBump: 0,

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
          const systemMsg: ChatMessage = {
            id: "system",
            role: "system",
            content: BILLY_SYSTEM_PROMPT,
            createdAt: 0,
          };

          // Inject the current editor state + workspace tree on every send
          // (re-read fresh so edits made between messages are visible to
          // Billy). We don't bake the context into history because that
          // would create stale snapshots.
          const flow = useFlowStore.getState();
          const ws = useWorkspaceStore.getState();
          const yamlPaths = listYamlPaths(ws.tree, ws.folderPath);

          const contextParts: string[] = [];
          if (yamlPaths.length > 0) {
            contextParts.push(
              `# Workspace files\n\nThe user has the workspace at \`${ws.folderPath ?? "(no folder)"}\` open. The following \`.yaml\` flow files exist:\n\n${yamlPaths
                .map((p) => `- ${p}`)
                .join("\n")}`,
            );
          }
          if (flow.content.trim()) {
            contextParts.push(
              `# Currently open file\n\nThe editor is showing \`${flow.filePath ?? "(unsaved)"}\` with this content:\n\n\`\`\`yaml\n${flow.content}\n\`\`\``,
            );
          }
          contextParts.push(
            `# How to propose modifications\n\n` +
              `- You can only directly modify the file currently open in the editor (shown above).\n` +
              `- If the user asks you to change a different file from the workspace list, ask them to open it first (the **Apply** button only operates on the current editor).\n` +
              `- When proposing a change to the open file, respond with the **complete new YAML** inside a single \`\`\`yaml fenced block. The UI will surface an Apply button on that block.`,
          );

          const contextMsg: ChatMessage | null = contextParts.length
            ? {
                id: "context",
                role: "system",
                content: contextParts.join("\n\n"),
                createdAt: 0,
              }
            : null;

          const history = get().messages.filter((m) => m.id !== assistantId);
          const stream = provider.stream({
            model: get().currentModel,
            messages: contextMsg ? [systemMsg, contextMsg, ...history] : [systemMsg, ...history],
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
                m.id === assistantId ? { ...m, content: m.content + "\n\n_[stopped]_" } : m,
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

      bumpScroll: () => set((s) => ({ scrollBump: s.scrollBump + 1 })),
    }),
    {
      name: "maestro-deck.chat",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        currentProvider: s.currentProvider,
        currentModel: s.currentModel,
      }),
    },
  ),
);
