// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Download, Loader2, RefreshCw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
            <div className="text-xs leading-relaxed text-foreground">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="mb-1 mt-2.5 text-xs font-medium first:mt-0">{children}</h3>
                  ),
                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                  ul: ({ children }) => (
                    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0 marker:text-muted-foreground">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0 marker:text-muted-foreground">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => <li className="pl-0.5">{children}</li>,
                  strong: ({ children }) => (
                    <strong className="font-semibold text-foreground">{children}</strong>
                  ),
                  em: ({ children }) => <em className="italic">{children}</em>,
                  code: ({ children }) => (
                    <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
                      {children}
                    </code>
                  ),
                  a: ({ children, href }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="font-medium text-primary underline-offset-2 hover:underline"
                    >
                      {children}
                    </a>
                  ),
                  hr: () => <hr className="my-3 border-border/60" />,
                }}
              >
                {available.notes}
              </ReactMarkdown>
            </div>
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
