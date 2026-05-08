import { Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageT } from "@/types/chat";

export function ChatMessage({ message }: { message: ChatMessageT }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary/40 text-primary-foreground ring-1 ring-primary/20">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 text-[11px] font-medium text-muted-foreground">
          Billy
        </div>
        {message.content ? (
          <div className="text-sm leading-relaxed text-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => (
                  <p className="mb-3 last:mb-0">{children}</p>
                ),
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
                pre: ({ children }) => (
                  <pre className="my-3 max-w-full overflow-x-auto rounded-lg border border-border bg-muted/60 p-3 font-mono text-[12px] leading-relaxed">
                    {children}
                  </pre>
                ),
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.startsWith("language-");
                  if (isBlock) {
                    return (
                      <code className={cn(className)} {...props}>
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
                  <th className="border-b border-border px-2 py-1.5 text-left font-semibold">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border-b border-border/40 px-2 py-1.5">{children}</td>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex h-5 items-center gap-1 text-muted-foreground">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
