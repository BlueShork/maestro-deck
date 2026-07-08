// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useState } from "react";
import type { ReactNode } from "react";

import { Check, Eye, EyeOff, ImageOff, RotateCcw, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useReviewStore } from "@/stores/reviewStore";
import { toast } from "@/stores/toastStore";
import { useVisualRegressionStore } from "@/stores/visualRegressionStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** Height fractions of the ignored system-bar bands, mirroring
 *  src-tauri/src/bank/mod.rs (status_bar_ratio / nav_bar_ratio). Used only to
 *  draw the review overlay — the actual masking happens in Rust. */
function maskRatios(deviceKey: string, on: boolean): { top: number; bottom: number } {
  if (!on) return { top: 0, bottom: 0 };
  const ios = /iphone|ipad|ipod/i.test(deviceKey);
  return ios ? { top: 0.06, bottom: 0.04 } : { top: 0.045, bottom: 0.045 };
}

/** Neutral checkerboard so transparent PNGs and white captures both read
 *  clearly against the dialog surface. */
const CHECKERBOARD =
  "[background-image:linear-gradient(45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(-45deg,hsl(var(--muted))_25%,transparent_25%),linear-gradient(45deg,transparent_75%,hsl(var(--muted))_75%),linear-gradient(-45deg,transparent_75%,hsl(var(--muted))_75%)] [background-position:0_0,0_8px,8px_-8px,-8px_0] [background-size:16px_16px]";

/** Dimmed, hatched band marking an ignored region (status / navigation bar). */
function IgnoredBand({ edge, pct }: { edge: "top" | "bottom"; pct: number }) {
  if (pct <= 0) return null;
  return (
    <div
      style={{ height: `${pct * 100}%` }}
      className={cn(
        "pointer-events-none absolute inset-x-0 flex items-center justify-center overflow-hidden bg-slate-900/40 [background-image:repeating-linear-gradient(45deg,transparent,transparent_5px,rgba(255,255,255,0.07)_5px,rgba(255,255,255,0.07)_10px)]",
        edge === "top" ? "top-0 border-b border-white/15" : "bottom-0 border-t border-white/15",
      )}
    >
      <span className="rounded-full bg-black/55 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wider text-white/85">
        ignored
      </span>
    </div>
  );
}

function ImageFrame({
  src,
  alt,
  accent,
  maskTop = 0,
  maskBottom = 0,
}: {
  src?: string;
  alt: string;
  accent: "neutral" | "warning";
  maskTop?: number;
  maskBottom?: number;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[12rem] flex-1 items-center justify-center overflow-auto rounded-md border",
        CHECKERBOARD,
        accent === "warning" ? "border-amber-500/40" : "border-border",
      )}
    >
      {src ? (
        <div className="relative">
          <img src={src} alt={alt} className="block max-h-[60vh] object-contain" />
          <IgnoredBand edge="top" pct={maskTop} />
          <IgnoredBand edge="bottom" pct={maskBottom} />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-1.5 py-10 text-xs text-muted-foreground">
          <ImageOff className="h-5 w-5" />
          No reference
        </div>
      )}
    </div>
  );
}

function PanelLabel({
  dot,
  title,
  hint,
  trailing,
}: {
  dot: string;
  title: string;
  hint: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        <span className="text-xs font-medium">{title}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      {trailing}
    </div>
  );
}

export function ScreenshotReview() {
  const open = useReviewStore((s) => s.open);
  const report = useReviewStore((s) => s.report);
  const queue = useReviewStore((s) => s.queue);
  const next = useReviewStore((s) => s.next);
  const close = useReviewStore((s) => s.close);
  const ignoreStatusBar = useVisualRegressionStore((s) => s.ignoreStatusBar);
  const [showDiff, setShowDiff] = useState(true);
  const [pending, setPending] = useState(false);

  if (!open || !report || queue.length === 0) return null;

  const name = queue[0];
  const comp = report.comparisons.find((c) => c.name === name);
  if (!comp) return null;

  const workspace = useWorkspaceStore.getState().folderPath ?? "";

  const reviewable = report.comparisons.filter(
    (c) => c.status === "changed" || c.status === "dimension_mismatch",
  ).length;
  const position = reviewable - queue.length + 1;

  const isDimMismatch = comp.status === "dimension_mismatch";
  const hasDiff = Boolean(comp.diff_b64);
  const overlayOn = showDiff && hasDiff;
  const changedPct = (comp.changed_ratio * 100).toFixed(2);
  const bbox = comp.bbox;
  // Ignored system-bar bands are drawn as an overlay (same fractions the Rust
  // diff excluded) rather than baked into the image.
  const mask = maskRatios(report.device_key, ignoreStatusBar);
  const masked = mask.top > 0 || mask.bottom > 0;

  const decide = async (decision: "keep" | "replace") => {
    if (pending) return;
    setPending(true);
    try {
      await ipc.resolveComparison({
        workspace,
        runId: report.run_id,
        deviceKey: report.device_key,
        name,
        decision,
      });
      setShowDiff(true);
      next();
    } catch (err) {
      toast.error("Could not update bank", err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="flex max-h-[92vh] w-[92vw] max-w-5xl flex-col gap-0 p-0">
        <DialogHeader className="space-y-2 border-b border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle className="flex items-center gap-2 text-base">
              Visual regression
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-normal">
                {name}
              </code>
            </DialogTitle>
            <span className="shrink-0 text-xs text-muted-foreground">
              {position} of {reviewable}
            </span>
          </div>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {isDimMismatch ? (
              <span className="inline-flex items-center gap-1.5 rounded bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                <TriangleAlert className="h-3.5 w-3.5" />
                Dimensions differ from the baseline
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
                <TriangleAlert className="h-3.5 w-3.5" />
                {changedPct}% of pixels changed
              </span>
            )}
            {bbox && (
              <span className="text-[11px] text-muted-foreground">
                changed region {bbox[2]}×{bbox[3]} at ({bbox[0]}, {bbox[1]})
              </span>
            )}
            {masked && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="h-2.5 w-3.5 rounded-[2px] bg-slate-900/40 [background-image:repeating-linear-gradient(45deg,transparent,transparent_2px,rgba(255,255,255,0.12)_2px,rgba(255,255,255,0.12)_4px)]" />
                system bars ignored
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="grid flex-1 grid-cols-2 gap-4 overflow-auto p-5">
          <figure className="flex flex-col gap-2">
            <PanelLabel dot="bg-emerald-500" title="Bank" hint="current source of truth" />
            <ImageFrame
              src={comp.bank_b64}
              alt="bank reference"
              accent="neutral"
              maskTop={mask.top}
              maskBottom={mask.bottom}
            />
          </figure>
          <figure className="flex flex-col gap-2">
            <PanelLabel
              dot="bg-amber-500"
              title="New capture"
              hint={overlayOn ? "changes highlighted in red" : "this run"}
              trailing={
                hasDiff ? (
                  <button
                    type="button"
                    onClick={() => setShowDiff((v) => !v)}
                    className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {showDiff ? (
                      <>
                        <EyeOff className="h-3 w-3" /> Hide diff
                      </>
                    ) : (
                      <>
                        <Eye className="h-3 w-3" /> Show diff
                      </>
                    )}
                  </button>
                ) : undefined
              }
            />
            <ImageFrame
              src={overlayOn ? comp.diff_b64 : comp.new_b64}
              alt="new capture"
              accent="warning"
              maskTop={mask.top}
              maskBottom={mask.bottom}
            />
          </figure>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <p className="text-xs text-muted-foreground">
            Keep marks this as a regression and leaves the bank untouched. Replace makes this
            capture the new baseline.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void decide("keep")}
            >
              <Check className="mr-1.5 h-3.5 w-3.5" />
              Keep bank
            </Button>
            <Button size="sm" disabled={pending} onClick={() => void decide("replace")}>
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Replace baseline
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
