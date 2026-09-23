// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Mic, Sparkles, Square, Volume2 } from "lucide-react";
import { isValidElement, memo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import type { ChatMessage as ChatMessageT, ContentBlock } from "@/types/chat";
import { messageText } from "@/lib/chat/content";
import { cn } from "@/lib/utils";
import { useBillyVoiceStore } from "@/stores/billyVoiceStore";
import { useChatStore } from "@/stores/chatStore";

import { CodeBlock } from "./CodeBlock";
import { ToolCallCard } from "./ToolCallCard";

function flattenChildren(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenChildren).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return flattenChildren(props.children);
  }
  return "";
}

function extractCodeFromPre(children: ReactNode): { language: string | null; code: string } | null {
  // ReactMarkdown wraps fenced code blocks as `<pre><code class="language-x">...</code></pre>`.
  // We unwrap to get the language and raw text so we can render our own
  // styled CodeBlock with action buttons.
  const codeEl = Array.isArray(children) ? children[0] : children;
  if (!isValidElement(codeEl)) return null;
  const props = codeEl.props as { className?: string; children?: ReactNode };
  const match = props.className?.match(/language-([\w-]+)/);
  const language = match ? match[1] : null;
  const code = flattenChildren(props.children).replace(/\n$/, "");
  return { language, code };
}

/** Local helper: renders a markdown string through the shared ReactMarkdown
 *  config. Extracted so both the string path and block text paths share
 *  the exact same renderer without duplication. */
function Markdown({ text }: { text: string }): ReactElement {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0 marker:text-muted-foreground">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0 marker:text-muted-foreground">
            {children}
          </ol>
        ),
        li: ({ children }) => <li className="pl-0.5">{children}</li>,
        pre: ({ children }) => {
          const block = extractCodeFromPre(children);
          if (!block) {
            return (
              <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[12px] leading-relaxed">
                {children}
              </pre>
            );
          }
          return <CodeBlock language={block.language} code={block.code} />;
        },
        code: ({ className, children, ...props }) => {
          const isBlock = className?.startsWith("language-");
          if (isBlock) {
            // The parent <pre> override owns the rendering for
            // fenced blocks; passthrough the inner <code> as-is so
            // markdown processors that look up the className still
            // see it (we don't actually rely on this at runtime).
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
          return (
            <code
              className="rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
              {...props}
            >
              {children}
            </code>
          );
        },
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {children}
          </a>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-foreground">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        h1: ({ children }) => (
          <h1 className="mb-2 mt-3 text-base font-semibold first:mt-0">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="mb-1 mt-2.5 text-sm font-medium first:mt-0">{children}</h3>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-2 border-primary/40 pl-3 italic text-muted-foreground last:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-3 border-border/60" />,
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto">
            <table className="w-full border-collapse text-xs">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border-b border-border px-2 py-1.5 text-left font-semibold">{children}</th>
        ),
        td: ({ children }) => <td className="border-b border-border/40 px-2 py-1.5">{children}</td>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

/** Given an array of ContentBlocks from the same message, find the tool_result
 *  that matches a given tool_use id. */
function findResult(
  blocks: ContentBlock[],
  toolUseId: string,
): Extract<ContentBlock, { type: "tool_result" }> | undefined {
  return blocks.find(
    (b): b is Extract<ContentBlock, { type: "tool_result" }> =>
      b.type === "tool_result" && b.toolUseId === toolUseId,
  );
}

/** Memoized: during streaming the chat store replaces only the message being
 *  appended to, so every other message keeps its object identity and skips the
 *  (expensive) ReactMarkdown re-render entirely. */
export const ChatMessage = memo(function ChatMessage({ message }: { message: ChatMessageT }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          {message.viaVoice && (
            <Mic
              aria-label="Asked by voice"
              className="mr-1.5 inline h-3 w-3 -translate-y-px opacity-70"
            />
          )}
          {messageText(message)}
        </div>
      </div>
    );
  }

  // ── assistant: block content ───────────────────────────────────────────────
  if (Array.isArray(message.content)) {
    const blocks = message.content;
    const hasVisibleContent = blocks.some((b) => b.type === "text" || b.type === "tool_use");

    return (
      <AssistantShell messageId={message.id}>
        {hasVisibleContent ? (
          <div className="text-sm leading-relaxed text-foreground">
            {blocks.map((block, i) => {
              if (block.type === "text" && block.text) {
                return <Markdown key={i} text={block.text} />;
              }
              if (block.type === "tool_use") {
                return (
                  <ToolCallCard key={block.id} use={block} result={findResult(blocks, block.id)} />
                );
              }
              // tool_result renders nothing standalone
              return null;
            })}
          </div>
        ) : (
          <PulseDots />
        )}
      </AssistantShell>
    );
  }

  // ── assistant: string content ───────────────────────────────────────────────
  return (
    <AssistantShell messageId={message.id}>
      {messageText(message) ? (
        <div className="text-sm leading-relaxed text-foreground">
          <Markdown text={messageText(message)} />
        </div>
      ) : (
        <PulseDots />
      )}
    </AssistantShell>
  );
});

/** Assistant chrome: avatar + name as a compact header ROW, content below at
 *  full panel width. The previous side-by-side avatar column indented every
 *  assistant message (text, tool cards, code blocks) by ~38px — too much for
 *  a narrow chat panel. */
function AssistantShell({ messageId, children }: { messageId: string; children: ReactNode }) {
  return (
    <div className="min-w-0 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-200">
      <div className="mb-1.5 flex items-center gap-2">
        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary/40 text-primary-foreground ring-1 ring-primary/20">
          <Sparkles className="h-3 w-3" />
        </div>
        <span className="text-[11px] font-medium text-muted-foreground">Billy</span>
        <SpeakButton messageId={messageId} />
      </div>
      {children}
    </div>
  );
}

/** Listen to / stop the spoken answer. Shown on answers to a voice question
 *  (read aloud automatically) and on any finished answer while the chat is
 *  on Maestro Deck, the provider that can speak. */
function SpeakButton({ messageId }: { messageId: string }) {
  const speaking = useBillyVoiceStore((s) => s.speakingId === messageId);
  const hasAudio = useBillyVoiceStore((s) => messageId in s.audio);
  const toggleSpeech = useBillyVoiceStore((s) => s.toggleSpeech);
  const canSpeak = useChatStore(
    (s) =>
      s.currentProvider === "maestrodeck" &&
      !(s.isStreaming && s.messages[s.messages.length - 1]?.id === messageId),
  );
  if (!speaking && !hasAudio && !canSpeak) return null;

  return (
    <button
      type="button"
      onClick={() => void toggleSpeech(messageId)}
      aria-label={speaking ? "Stop reading aloud" : "Read aloud"}
      title={speaking ? "Stop" : "Read aloud"}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
        speaking && "text-primary",
      )}
    >
      {speaking ? <Square className="h-2.5 w-2.5 fill-current" /> : <Volume2 className="h-3 w-3" />}
    </button>
  );
}

function PulseDots() {
  return (
    <div className="flex h-5 items-center gap-1 text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-bounce" />
      <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-bounce [animation-delay:120ms]" />
      <span className="h-1.5 w-1.5 rounded-full bg-current motion-safe:animate-bounce [animation-delay:240ms]" />
    </div>
  );
}
