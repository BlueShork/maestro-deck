import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import type { ChatMessage as ChatMessageT } from "@/types/chat";

export function ChatMessage({ message }: { message: ChatMessageT }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-sm",
          isUser
            ? "whitespace-pre-wrap break-words bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {message.content ? (
          isUser ? (
            message.content
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
                ul: ({ children }) => (
                  <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>
                ),
                li: ({ children }) => <li className="mb-0.5">{children}</li>,
                code: ({ className, children, ...props }) => {
                  const isBlock = className?.startsWith("language-");
                  if (isBlock) {
                    return (
                      <pre className="my-2 overflow-x-auto rounded-md border border-border bg-background p-2 font-mono text-xs">
                        <code {...props}>{children}</code>
                      </pre>
                    );
                  }
                  return (
                    <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]" {...props}>
                      {children}
                    </code>
                  );
                },
                a: ({ children, href }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary underline underline-offset-2"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                em: ({ children }) => <em className="italic">{children}</em>,
                h1: ({ children }) => <h1 className="mb-2 mt-1 text-base font-semibold">{children}</h1>,
                h2: ({ children }) => <h2 className="mb-1.5 mt-1 text-sm font-semibold">{children}</h2>,
                h3: ({ children }) => <h3 className="mb-1 mt-1 text-sm font-medium">{children}</h3>,
                blockquote: ({ children }) => (
                  <blockquote className="mb-2 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
                    {children}
                  </blockquote>
                ),
                hr: () => <hr className="my-2 border-border" />,
              }}
            >
              {message.content}
            </ReactMarkdown>
          )
        ) : (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <span className="h-1 w-1 animate-pulse rounded-full bg-current" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:120ms]" />
            <span className="h-1 w-1 animate-pulse rounded-full bg-current [animation-delay:240ms]" />
          </span>
        )}
      </div>
    </div>
  );
}
