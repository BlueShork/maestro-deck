// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Play, Sparkles } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { useCanAskBilly } from "@/lib/chat/canAskBilly";
import type { Step } from "@/lib/flowAst";
import { useChatStore } from "@/stores/chatStore";

interface StepContextMenuProps {
  /** Viewport point the menu opens at (the right-click position). */
  x: number;
  y: number;
  step: Step;
  /** The step's YAML, quoted to Billy so the question has its subject. */
  snippet: string;
  onRunFrom?: (line: number) => void;
  onClose: () => void;
}

/**
 * Right-click menu on a flow step: run from it, or ask Billy about it. The
 * header names the step so it's clear which one the actions target. Laid out
 * like the inspector's action menu.
 */
export function StepContextMenu({ x, y, step, snippet, onRunFrom, onClose }: StepContextMenuProps) {
  const canAsk = useCanAskBilly();

  const askBilly = () => {
    useChatStore
      .getState()
      .compose(`About this step (line ${step.line}):\n\n\`\`\`yaml\n${snippet}\n\`\`\`\n\n`);
  };

  return (
    <DropdownMenu open onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            left: x,
            top: y,
            width: 0,
            height: 0,
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="w-56 p-0 shadow-xl">
        <div className="border-b border-border px-3 py-2">
          <div className="truncate font-mono text-[11px] font-medium">{step.command}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            Line {step.line}
            {step.arg ? ` · ${step.arg}` : ""}
          </div>
        </div>
        <div className="p-1">
          {onRunFrom ? (
            <DropdownMenuItem
              onSelect={() => {
                onClose();
                onRunFrom(step.line);
              }}
              className="gap-2 text-xs"
            >
              <Play className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              Run from this step
            </DropdownMenuItem>
          ) : null}
          {onRunFrom && canAsk ? <DropdownMenuSeparator /> : null}
          {canAsk ? (
            <DropdownMenuItem
              onSelect={() => {
                onClose();
                askBilly();
              }}
              className="gap-2 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
              Ask Billy about this step
            </DropdownMenuItem>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
