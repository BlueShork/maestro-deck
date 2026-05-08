import { Sparkles, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useChatStore } from "@/stores/chatStore";

import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";

interface ChatPanelProps {
  onOpenSettings: () => void;
}

export function ChatPanel({ onOpenSettings }: ChatPanelProps) {
  const setOpen = useChatStore((s) => s.setOpen);
  const clear = useChatStore((s) => s.clear);
  const error = useChatStore((s) => s.error);

  return (
    <div className="flex h-full flex-col border-l border-border bg-background">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">AI assistant</span>
        <div className="ml-2 flex-1">
          <ModelPicker />
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={clear}
          aria-label="Clear conversation"
          title="Clear conversation"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
        >
          <X className="h-4 w-4" />
        </Button>
      </header>

      <MessageList onOpenSettings={onOpenSettings} />

      {error && (
        <div className="mx-3 mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <ChatInput />
    </div>
  );
}
