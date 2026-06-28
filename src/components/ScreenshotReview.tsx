// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ipc } from "@/lib/ipc";
import { useReviewStore } from "@/stores/reviewStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export function ScreenshotReview() {
  const open = useReviewStore((s) => s.open);
  const report = useReviewStore((s) => s.report);
  const queue = useReviewStore((s) => s.queue);
  const next = useReviewStore((s) => s.next);
  const close = useReviewStore((s) => s.close);
  const [showDiff, setShowDiff] = useState(true);

  if (!open || !report || queue.length === 0) return null;

  const name = queue[0];
  const comp = report.comparisons.find((c) => c.name === name);
  if (!comp) return null;

  const workspace = useWorkspaceStore.getState().folderPath ?? "";

  const decide = async (decision: "keep" | "replace") => {
    try {
      await ipc.resolveComparison({
        workspace,
        runId: report.run_id,
        deviceKey: report.device_key,
        name,
        decision,
      });
    } catch (err) {
      console.error("resolve_comparison failed", err);
    } finally {
      setShowDiff(true);
      next();
    }
  };

  const bbox = comp.bbox;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="flex max-h-[90vh] w-[90vw] max-w-5xl flex-col p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>
            Visual regression — &ldquo;{name}&rdquo; ({queue.length} remaining)
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-xs">
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={showDiff}
                onChange={(e) => setShowDiff(e.target.checked)}
                className="cursor-pointer"
              />
              Show diff overlay
            </label>
            {bbox && (
              <span className="text-muted-foreground">
                Changed zone: x={bbox[0]} y={bbox[1]} {bbox[2]}×{bbox[3]}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-cols-2 gap-3 overflow-auto p-4">
          <figure className="flex flex-col items-center gap-1">
            <figcaption className="text-xs text-muted-foreground">Bank (reference)</figcaption>
            {comp.bank_b64 ? (
              <img
                src={comp.bank_b64}
                alt="bank reference"
                className="max-h-[65vh] object-contain"
              />
            ) : (
              <div className="flex h-32 w-full items-center justify-center rounded border border-border text-xs text-muted-foreground">
                No reference
              </div>
            )}
          </figure>
          <figure className="flex flex-col items-center gap-1">
            <figcaption className="text-xs text-muted-foreground">
              New capture{showDiff ? " (diff overlay)" : ""}
            </figcaption>
            <img
              src={showDiff ? (comp.diff_b64 ?? comp.new_b64) : comp.new_b64}
              alt="new capture"
              className="max-h-[65vh] object-contain"
            />
          </figure>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => void decide("keep")}>
            Keep bank (regression)
          </Button>
          <Button size="sm" onClick={() => void decide("replace")}>
            Replace with new
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
