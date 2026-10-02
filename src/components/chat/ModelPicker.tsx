// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { PixelChevron } from "@/components/brand/Pixel";
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
  maestrodeck: "Maestro Deck",
  anthropic: "Anthropic",
  vertex: "Vertex AI",
};

export function ModelPicker() {
  const provider = useChatStore((s) => s.currentProvider);
  const model = useChatStore((s) => s.currentModel);
  const setProvider = useChatStore((s) => s.setProvider);

  const current = MODELS.find((m) => m.id === model && m.provider === provider);
  const label = current ? `${PROVIDER_LABEL[provider]} · ${current.label}` : "Select model";

  const grouped: Record<ProviderId, typeof MODELS> = {
    maestrodeck: [],
    anthropic: [],
    vertex: [],
  };
  for (const m of MODELS) grouped[m.provider].push(m);

  return (
    // Non-modal: the default modal mode scroll-locks the body and applies
    // aria-hidden/inert to the ENTIRE app (video canvas, editor, message
    // list) on every open/close — a full a11y-tree recompute that visibly
    // janks the picker. A small menu doesn't need outside-interaction
    // blocking.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-1.5 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {label}
          <PixelChevron direction="down" size={8} />
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
