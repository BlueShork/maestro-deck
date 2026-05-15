// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { MODELS } from "@/lib/chat/models";
import { useChatStore } from "@/stores/chatStore";
import type { ProviderId } from "@/types/chat";

const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  vertex: "Vertex AI",
};

export function ModelPicker() {
  const provider = useChatStore((s) => s.currentProvider);
  const model = useChatStore((s) => s.currentModel);
  const setProvider = useChatStore((s) => s.setProvider);

  const current = MODELS.find((m) => m.id === model && m.provider === provider);
  const label = current ? `${PROVIDER_LABEL[provider]} · ${current.label}` : "Select model";

  const grouped: Record<ProviderId, typeof MODELS> = { anthropic: [], vertex: [] };
  for (const m of MODELS) grouped[m.provider].push(m);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          {label}
          <ChevronDown className="h-3 w-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {(Object.keys(grouped) as ProviderId[]).map((p, i) => (
          <div key={p}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>{PROVIDER_LABEL[p]}</DropdownMenuLabel>
            {grouped[p].map((m) => (
              <DropdownMenuItem key={`${p}:${m.id}`} onSelect={() => setProvider(p, m.id)}>
                {m.label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
