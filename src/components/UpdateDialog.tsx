// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ArrowDown } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ScrollArea } from "@/components/ui/ScrollArea";
import TearTicket from "@/components/ui/TearTicket";
import { useUpdateStore } from "@/stores/updateStore";

import "./UpdateDialog.css";

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
    <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0 marker:text-white/40">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0 marker:text-white/40">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children }) => (
    <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.85em] text-white">
      {children}
    </code>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-white underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-3 border-white/15" />,
};

const TICKET_WIDTH = 380;
const TICKET_HEIGHT = 580;
const STUB_SIZE = 120;

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
        <DialogPrimitive.Overlay className="update-ticket-overlay fixed inset-0 z-[100] bg-black/45 backdrop-blur-xl" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="update-ticket-dialog fixed inset-0 z-[101] flex flex-col items-center justify-center gap-5 p-4 outline-none"
          onPointerDownOutside={(e) => {
            if (busy) e.preventDefault();
          }}
        >
          <TearTicket
            className="update-ticket"
            orientation="vertical"
            width={TICKET_WIDTH}
            height={TICKET_HEIGHT}
            stubSize={STUB_SIZE}
            radius={18}
            holes={16}
            roughness={0.8}
            rotate={-2}
            image="/logo-horizontal-white.svg"
            imageAlt="Maestro Deck"
            scrim={false}
            imageRadius={12}
            background="#161618"
            borderColor="rgb(255 255 255 / 0.14)"
            color="#fafafa"
            torn={phase !== "available"}
            onTear={() => void downloadAndInstall()}
            ariaLabel="Tear off the stub to install the update"
            stub={<TicketStub version={available?.version} />}
          >
            <div className="update-ticket__body">
              <DialogPrimitive.Title asChild>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/45">
                    {phase === "error" ? "Update failed" : "New version"}
                  </p>
                  <p className="mt-1 text-3xl font-bold tracking-tight">
                    {available ? `v${available.version}` : "Update"}
                  </p>
                </div>
              </DialogPrimitive.Title>

              <div className="update-ticket__rule" />

              {phase === "error" ? (
                <p className="text-xs leading-relaxed text-red-300">{error}</p>
              ) : busy ? (
                <div className="flex flex-1 flex-col justify-center gap-3">
                  <p className="text-sm text-white/80">
                    {phase === "downloading"
                      ? "Downloading the new version…"
                      : "Installing — Maestro Deck will restart in a moment."}
                  </p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-white transition-[width] duration-150"
                      style={{ width: `${phase === "downloading" ? downloadPercent : 100}%` }}
                    />
                  </div>
                  <p className="font-mono text-[11px] tabular-nums text-white/45">
                    {phase === "downloading" ? `${downloadPercent.toFixed(0)}%` : "Restarting…"}
                  </p>
                </div>
              ) : available?.notes ? (
                <ScrollArea className="update-ticket__notes min-h-0 flex-1">
                  <div className="pr-3 text-xs leading-relaxed text-white/85">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={NOTES_MARKDOWN_COMPONENTS}
                    >
                      {available.notes}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              ) : (
                <p className="text-sm text-white/70">
                  A new version of Maestro Deck is ready to install.
                </p>
              )}
            </div>
          </TearTicket>

          {phase === "available" || phase === "error" ? (
            <DialogPrimitive.Close className="rounded-full px-4 py-1.5 text-xs font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40">
              {phase === "error" ? "Dismiss" : "Later"}
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function TicketStub({ version }: { version?: string }) {
  return (
    <div className="update-ticket__stub">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ArrowDown className="h-4 w-4" />
        Tear to install
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-white/40">
        Admit one{version ? ` · No. ${version}` : ""}
      </p>
    </div>
  );
}
