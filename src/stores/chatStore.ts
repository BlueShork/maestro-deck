// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { runAgentLoop, TURN_LIMIT_NOTICE } from "@/lib/chat/agentLoop";
import { MAESTRODECK_MODEL } from "@/lib/chat/models";
import { getProvider } from "@/lib/chat/registry";
import { getEffectiveBillyPrompt } from "@/lib/chat/systemPrompt";
import { ALL_TOOLS, executeTool } from "@/lib/chat/tools";
import { useFlowStore } from "@/stores/flowStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import type { WorkspaceNode } from "@/types";
import type { ChatMessage, ContentBlock, ProviderId } from "@/types/chat";

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

  /** Text waiting to be placed in the chat input (e.g. from the editor's
   *  "Ask Billy" menu). ChatInput takes it and clears it. */
  draft: string | null;

  toggle: () => void;
  setOpen: (open: boolean) => void;
  setProvider: (provider: ProviderId, model: string) => void;
  /** Resolves with the answer's message id once Billy has finished, or null
   *  when nothing was sent, it failed, or the user stopped it. */
  sendMessage: (text: string, opts?: { viaVoice?: boolean }) => Promise<string | null>;
  cancel: () => void;
  clear: () => void;
  bumpScroll: () => void;
  /** Opens the panel with `text` in the input, for the user to finish. */
  compose: (text: string) => void;
  takeDraft: () => string | null;
}

// Billy on Maestro Deck Cloud needs no key, only an account, so it's what a
// fresh install starts on. A choice already made is persisted and kept.
const DEFAULTS = {
  provider: "maestrodeck" as ProviderId,
  model: MAESTRODECK_MODEL.id,
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
      draft: null,

      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setOpen: (open) => set({ isOpen: open }),

      setProvider: (provider, model) =>
        set({ currentProvider: provider, currentModel: model, error: null }),

      sendMessage: async (text, opts) => {
        const trimmed = text.trim();
        if (!trimmed || get().isStreaming) return null;

        const provider = await getProvider(get().currentProvider);
        if (!provider) {
          set({
            error:
              get().currentProvider === "maestrodeck"
                ? "Sign in to your Maestro Deck account to use Billy, or pick your own key in Settings → AI."
                : "No credentials configured for this provider. Open Settings to add them.",
          });
          return null;
        }

        const userMsg: ChatMessage = {
          id: crypto.randomUUID(),
          role: "user",
          content: trimmed,
          createdAt: Date.now(),
          ...(opts?.viaVoice ? { viaVoice: true } : {}),
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
            content: getEffectiveBillyPrompt(),
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
          if (opts?.viaVoice) {
            contextParts.push(
              `# Voice\n\n` +
                `The user asked this out loud, and your final answer (the text after your last tool call) will be read aloud by a voice synthesizer. ` +
                `Keep that final answer to 2 to 4 short, natural sentences: no lists, tables, headings or emojis. ` +
                `Put any YAML or command in a code block after the explanation: it is shown on screen, not read.`,
            );
          }
          contextParts.push(
            `# Modifying files\n\n` +
              `- Use the write_flow tool to create or modify flow files directly — the editor refreshes automatically.\n` +
              `- Only fall back to a fenced \`\`\`yaml block (Apply button) when the user explicitly asks to review the change before it lands.`,
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
          const base = contextMsg ? [systemMsg, contextMsg, ...history] : [systemMsg, ...history];

          const appendBlock = (block: ContentBlock) =>
            set((s) => ({
              messages: s.messages.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      content:
                        typeof m.content === "string"
                          ? m.content
                            ? ([{ type: "text", text: m.content }, block] as ContentBlock[])
                            : [block]
                          : [...m.content, block],
                    }
                  : m,
              ),
            }));

          for await (const evt of runAgentLoop({
            provider,
            model: get().currentModel,
            tools: ALL_TOOLS,
            messages: base,
            signal: abort.signal,
            execute: executeTool,
          })) {
            if (evt.type === "text_delta") {
              set((s) => ({
                messages: s.messages.map((m) => {
                  if (m.id !== assistantId) return m;
                  if (typeof m.content === "string") return { ...m, content: m.content + evt.text };
                  const blocks = m.content.slice();
                  const last = blocks[blocks.length - 1];
                  if (last?.type === "text")
                    blocks[blocks.length - 1] = { ...last, text: last.text + evt.text };
                  else blocks.push({ type: "text", text: evt.text });
                  return { ...m, content: blocks };
                }),
              }));
            } else if (evt.type === "tool_use" || evt.type === "tool_result") {
              appendBlock(evt.block);
            } else {
              appendBlock({ type: "text", text: `\n\n_${TURN_LIMIT_NOTICE}_` });
            }
          }
          // The loop can also return early on a stop, without throwing.
          return abort.signal.aborted ? null : assistantId;
        } catch (err) {
          if (abort.signal.aborted) {
            set((s) => ({
              messages: s.messages.map((m) => {
                if (m.id !== assistantId) return m;
                const stopped = "\n\n_[stopped]_";
                if (typeof m.content === "string") {
                  return { ...m, content: m.content + stopped };
                }
                // Content is an array; append to the trailing text block or push a new one
                const blocks = [...m.content];
                const lastBlock = blocks[blocks.length - 1];
                if (lastBlock?.type === "text") {
                  blocks[blocks.length - 1] = {
                    ...lastBlock,
                    text: lastBlock.text + stopped,
                  };
                } else {
                  blocks.push({ type: "text", text: stopped });
                }
                return { ...m, content: blocks };
              }),
            }));
          } else {
            const message = err instanceof Error ? err.message : String(err);
            set((s) => ({
              messages: s.messages.filter((m) => m.id !== assistantId),
              error: message,
            }));
          }
          return null;
        } finally {
          set({ isStreaming: false, abort: null });
        }
      },

      cancel: () => {
        get().abort?.abort();
      },

      clear: () => set({ messages: [], error: null }),

      bumpScroll: () => set((s) => ({ scrollBump: s.scrollBump + 1 })),

      compose: (text) => set({ isOpen: true, draft: text }),
      takeDraft: () => {
        const { draft } = get();
        if (draft !== null) set({ draft: null });
        return draft;
      },
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
