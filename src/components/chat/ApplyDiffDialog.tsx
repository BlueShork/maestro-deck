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
import { cn } from "@/lib/utils";
import { useFlowStore } from "@/stores/flowStore";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposed: string;
}

type Op = "same" | "add" | "del";
interface DiffLine {
  op: Op;
  oldNo: number | null;
  newNo: number | null;
  text: string;
}

/**
 * Tiny LCS-based line diff. Good enough for human-sized YAML flows.
 * Not optimised — runs in O(n*m) with O(n*m) memory, fine up to ~1k
 * lines per side. A Maestro flow that big would have other problems.
 */
function computeDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  // dp[i][j] = LCS length of a[0..i] and b[0..j]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", oldNo: i + 1, newNo: j + 1, text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: "del", oldNo: i + 1, newNo: null, text: a[i] });
      i++;
    } else {
      out.push({ op: "add", oldNo: null, newNo: j + 1, text: b[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "del", oldNo: i + 1, newNo: null, text: a[i++] });
  while (j < m) out.push({ op: "add", oldNo: null, newNo: j + 1, text: b[j++] });
  return out;
}

export function ApplyDiffDialog({ open, onOpenChange, proposed }: Props) {
  const current = useFlowStore((s) => s.content);
  const filePath = useFlowStore((s) => s.filePath);
  const setContent = useFlowStore((s) => s.setContent);

  const diff = useMemo(() => {
    return computeDiff(current.split("\n"), proposed.split("\n"));
  }, [current, proposed]);

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
    setContent(proposed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-3xl flex-col p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Apply changes to {filePath ?? "current file"}?</DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            <span className="text-emerald-500">+{stats.added}</span>
            <span className="text-destructive">−{stats.removed}</span>
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
                    line.op === "add" && "bg-emerald-500/10",
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
                    {line.op === "add" && <Plus className="inline h-3 w-3 text-emerald-500" />}
                    {line.op === "del" && <Minus className="inline h-3 w-3 text-destructive" />}
                  </td>
                  <td className="whitespace-pre px-2 py-0.5 align-top">{line.text || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
