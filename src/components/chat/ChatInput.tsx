import { Send, Square } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/Button";
import { useChatStore } from "@/stores/chatStore";

export function ChatInput() {
  const [value, setValue] = useState("");
  const isStreaming = useChatStore((s) => s.isStreaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancel = useChatStore((s) => s.cancel);
  const ref = useRef<HTMLTextAreaElement | null>(null);

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

  return (
    <div className="flex items-end gap-2 border-t border-border p-3">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask anything…"
        disabled={isStreaming}
        rows={2}
        className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
      />
      {isStreaming ? (
        <Button size="icon" variant="outline" onClick={cancel} aria-label="Stop">
          <Square className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          onClick={submit}
          disabled={!value.trim()}
          aria-label="Send"
        >
          <Send className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
