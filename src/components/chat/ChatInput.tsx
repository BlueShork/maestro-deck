import { ArrowUp, Square } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";

const MAX_HEIGHT = 180;

export function ChatInput() {
  const [value, setValue] = useState("");
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancel = useChatStore((s) => s.cancel);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Auto-grow textarea up to MAX_HEIGHT.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, MAX_HEIGHT);
    el.style.height = `${next}px`;
  }, [value]);

  const submit = () => {
    const text = value;
    if (!text.trim()) return;
    setValue("");
    void sendMessage(text);
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0;

  return (
    <div className="px-3 pb-3 pt-2">
      <div
        className={cn(
          "group relative flex flex-col rounded-2xl border border-border bg-muted/40 px-3 pt-2.5 pb-2 transition-colors",
          "focus-within:border-primary/60 focus-within:bg-background focus-within:shadow-sm",
        )}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Message Billy…"
          disabled={isStreaming}
          rows={1}
          className={cn(
            "max-h-[180px] w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground",
            "disabled:opacity-50",
          )}
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <span className="text-[10px] text-muted-foreground/70">
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[9px]">
              Enter
            </kbd>{" "}
            to send,{" "}
            <kbd className="rounded border border-border bg-background px-1 font-mono text-[9px]">
              Shift + Enter
            </kbd>{" "}
            for newline
          </span>
          {isStreaming ? (
            <button
              type="button"
              onClick={cancel}
              aria-label="Stop"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              aria-label="Send"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full transition-all",
                canSend
                  ? "bg-primary text-primary-foreground hover:scale-105"
                  : "bg-muted text-muted-foreground/50 cursor-not-allowed",
              )}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
