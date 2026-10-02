// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Trash2, X } from "lucide-react";

import { PanelAction, PanelHeader } from "@/components/PanelHeader";
import { useChatStore } from "@/stores/chatStore";

import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import { ModelPicker } from "./ModelPicker";

export function ChatPanel() {
  const setOpen = useChatStore((s) => s.setOpen);
  const clear = useChatStore((s) => s.clear);
  const error = useChatStore((s) => s.error);

  return (
    <div className="flex h-full flex-col bg-background">
      <PanelHeader title="Billy" meta={<ModelPicker />}>
        <PanelAction onClick={clear} aria-label="Clear conversation" title="Clear conversation">
          <Trash2 className="h-3.5 w-3.5" />
        </PanelAction>
        <PanelAction onClick={() => setOpen(false)} aria-label="Close assistant" title="Close">
          <X className="h-3.5 w-3.5" />
        </PanelAction>
      </PanelHeader>

      <MessageList />

      {error && (
        <div className="mx-3 mb-2 border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <ChatInput />
    </div>
  );
}
