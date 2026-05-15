// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Download, Loader2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useUpdateStore } from "@/stores/updateStore";

export function UpdateDialog() {
  const phase = useUpdateStore((s) => s.phase);
  const available = useUpdateStore((s) => s.available);
  const downloadPercent = useUpdateStore((s) => s.downloadPercent);
  const error = useUpdateStore((s) => s.error);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);
  const reset = useUpdateStore((s) => s.reset);

  const open =
    phase === "available" ||
    phase === "downloading" ||
    phase === "installing" ||
    phase === "ready" ||
    (phase === "error" && error !== null);

  const busy = phase === "downloading" || phase === "installing" || phase === "ready";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {phase === "error"
              ? "Update failed"
              : available
                ? `Update available — v${available.version}`
                : "Update"}
          </DialogTitle>
          <DialogDescription>
            {phase === "error"
              ? "We couldn't complete the update. You can try again later."
              : phase === "downloading"
                ? "Downloading the new version…"
                : phase === "installing" || phase === "ready"
                  ? "Installing — Maestro Deck will restart in a moment."
                  : "A new version of Maestro Deck is ready to install."}
          </DialogDescription>
        </DialogHeader>

        {phase === "error" ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {error}
          </p>
        ) : available?.notes ? (
          <ScrollArea className="max-h-72 rounded-md border border-border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground">
              {available.notes}
            </pre>
          </ScrollArea>
        ) : null}

        {phase === "downloading" ? (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary transition-[width] duration-150"
              style={{ width: `${downloadPercent}%` }}
            />
          </div>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {phase === "available" ? (
            <>
              <Button variant="ghost" size="sm" onClick={reset}>
                Later
              </Button>
              <Button size="sm" onClick={() => void downloadAndInstall()} className="gap-1.5">
                <Download className="h-3.5 w-3.5" />
                Download &amp; install
              </Button>
            </>
          ) : phase === "error" ? (
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Dismiss
            </Button>
          ) : (
            <Button size="sm" disabled className="gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {phase === "downloading"
                ? `${downloadPercent.toFixed(0)}%`
                : phase === "installing"
                  ? "Installing…"
                  : "Restarting…"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
