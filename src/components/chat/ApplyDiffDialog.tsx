// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Check, Minus, Plus } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { lineDiff } from "@/lib/lineDiff";
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposed: string;
}

export function ApplyDiffDialog({ open, onOpenChange, proposed }: Props) {
  const current = useFlowStore((s) => s.content);
  const filePath = useFlowStore((s) => s.filePath);
  const setContent = useFlowStore((s) => s.setContent);
  const next = current.endsWith("\n") && !proposed.endsWith("\n") ? `${proposed}\n` : proposed;

  // Every YAML block in the chat mounts one of these; only an open dialog
  // pays for the diff (it would otherwise rerun on each editor keystroke).
  const diff = useMemo(
    () => (open ? lineDiff(current.split("\n"), next.split("\n")) : []),
    [open, current, next],
  );

  const stats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const line of diff) {
      if (line.op === "add") added++;
      else if (line.op === "del") removed++;
    }
    return { added, removed };
  }, [diff]);

  const apply = () => {
    setContent(next);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col p-0">
        <DialogHeader className="border-b border-border px-5 pb-4 pt-6">
          <DialogTitle>Apply changes to {filePath ?? "current file"}?</DialogTitle>
          <DialogDescription className="flex items-center gap-3 font-mono text-[11px] uppercase">
            <span className="bg-success/15 px-1.5 py-0.5 text-success">+{stats.added}</span>
            <span className="bg-destructive/15 px-1.5 py-0.5 text-destructive">
              −{stats.removed}
            </span>
            <span className="text-muted-foreground">
              The current YAML will be replaced with Billy's proposal.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          <table className="w-full border-collapse font-mono text-[12px]">
            <tbody>
              {diff.map((line, idx) => (
                <tr
                  key={idx}
                  className={cn(
                    line.op === "add" && "bg-success/10",
                    line.op === "del" && "bg-destructive/10",
                  )}
                >
                  <td className="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground/60 align-top w-10">
                    {line.oldNo ?? ""}
                  </td>
                  <td className="select-none border-r border-border/40 px-2 py-0.5 text-right text-muted-foreground/60 align-top w-10">
                    {line.newNo ?? ""}
                  </td>
                  <td className="select-none border-r border-border/40 px-1 text-center align-top w-6">
                    {line.op === "add" && <Plus className="inline h-3 w-3 text-success" />}
                    {line.op === "del" && <Minus className="inline h-3 w-3 text-destructive" />}
                  </td>
                  <td className="whitespace-pre px-2 py-0.5 align-top">{line.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={apply} className="gap-1.5">
            <Check className="h-4 w-4" />
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
