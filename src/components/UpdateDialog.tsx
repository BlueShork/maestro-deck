// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import * as DialogPrimitive from "@radix-ui/react-dialog";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { PixelChevron, PixelMosaic, PixelWordmark } from "@/components/brand/Pixel";
import { Button } from "@/components/ui/Button";
import { ScrollArea } from "@/components/ui/ScrollArea";
import { useUpdateStore } from "@/stores/updateStore";

// Hoisted out of the component so the element factories aren't recreated on
// every render (and each isn't flagged as a nested component definition).
const NOTES_MARKDOWN_COMPONENTS: Components = {
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-sm font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => <h3 className="mb-1 mt-2.5 text-xs font-medium first:mt-0">{children}</h3>,
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0 marker:text-brand">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0 marker:text-brand">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="bg-surface px-1 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-foreground underline decoration-brand underline-offset-2 hover:text-brand"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-border" />,
};

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
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) reset();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        {/* Landing product panel: a warm block mosaic carrying the version,
            then the notes and the light call to action. */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 z-[101] flex max-h-[min(640px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <PixelMosaic
            cols={14}
            rows={5}
            palette={phase === "error" ? "red" : "orange"}
            seed={7}
            className="h-40 shrink-0 border-b border-border"
          >
            <div className="absolute bottom-0 left-0 flex items-center bg-background px-4 py-3">
              <PixelWordmark className="w-36" />
            </div>
          </PixelMosaic>

          <div className="flex min-h-0 flex-1 flex-col gap-4 p-5">
            <DialogPrimitive.Title asChild>
              <div>
                <p className="mono-label">{phase === "error" ? "Update failed" : "New version"}</p>
                <p className="mt-1.5 font-display text-4xl font-medium leading-none tracking-[-0.045em]">
                  {available ? `v${available.version}` : "Update"}
                </p>
              </div>
            </DialogPrimitive.Title>

            {phase === "error" ? (
              <p className="text-xs leading-relaxed text-destructive">{error}</p>
            ) : busy ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-foreground">
                  {phase === "downloading"
                    ? "Downloading the new version…"
                    : "Installing — Maestro Deck will restart in a moment."}
                </p>
                {/* Landing CI bar: stepped orange fill, green once done. */}
                <div className="h-1.5 bg-surface">
                  <div
                    className={
                      phase === "downloading"
                        ? "h-full bg-brand transition-[width] duration-150 [transition-timing-function:steps(4,end)]"
                        : "h-full bg-success"
                    }
                    style={{ width: `${phase === "downloading" ? downloadPercent : 100}%` }}
                  />
                </div>
                <p className="font-mono text-[11px] uppercase tabular-nums text-muted-foreground">
                  {phase === "downloading" ? `${downloadPercent.toFixed(0)}%` : "Restarting…"}
                </p>
              </div>
            ) : available?.notes ? (
              <ScrollArea className="min-h-0 flex-1 border-t border-border pt-3">
                <div className="max-h-64 pr-3 text-xs leading-relaxed text-muted-foreground">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={NOTES_MARKDOWN_COMPONENTS}>
                    {available.notes}
                  </ReactMarkdown>
                </div>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">
                A new version of Maestro Deck is ready to install.
              </p>
            )}

            {phase === "available" || phase === "error" ? (
              <div className="flex justify-end gap-2">
                <DialogPrimitive.Close asChild>
                  <Button variant="secondary" className="h-9 px-4">
                    {phase === "error" ? "Dismiss" : "Later"}
                  </Button>
                </DialogPrimitive.Close>
                {phase === "available" ? (
                  <Button
                    className="group h-9 gap-2.5 px-4"
                    onClick={() => void downloadAndInstall()}
                  >
                    Install update
                    <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
