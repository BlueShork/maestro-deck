// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { credentials } from "@/lib/chat/credentials";
import { useChatStore } from "@/stores/chatStore";

import { ChatMessage } from "./ChatMessage";

interface MessageListProps {
  onOpenSettings: () => void;
}

export function MessageList({ onOpenSettings }: MessageListProps) {
  const messages = useChatStore((s) => s.messages);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const isOpen = useChatStore((s) => s.isOpen);
  const scrollBump = useChatStore((s) => s.scrollBump);
  const ref = useRef<HTMLDivElement | null>(null);

  // null = unknown (still checking), boolean = result
  const [hasCreds, setHasCreds] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      const [a, v] = await Promise.all([
        credentials.getAnthropic().catch(() => null),
        credentials.getVertex().catch(() => null),
      ]);
      if (cancelled) return;
      setHasCreds(Boolean(a?.apiKey) || Boolean(v?.serviceAccountJson));
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, messages.length]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, isStreaming, scrollBump]);

  if (messages.length === 0) {
    if (hasCreds === null) {
      return <div className="flex-1" />;
    }
    if (!hasCreds) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Bring your own key</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            Configure an Anthropic or Vertex AI provider in Settings, then start chatting.
            Credentials stay on this machine, encrypted at rest.
          </p>
          <Button size="sm" variant="outline" onClick={onOpenSettings}>
            Open settings
          </Button>
        </div>
      );
    }
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Sparkles className="h-8 w-8 text-primary" />
        <p className="text-base font-semibold">Billy Assistant</p>
        <p className="max-w-xs text-sm text-muted-foreground">Hello, how can I help you today?</p>
      </div>
    );
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3 pt-8">
      <div className="flex min-w-0 flex-col gap-5">
        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} />
        ))}
      </div>
    </div>
  );
}
