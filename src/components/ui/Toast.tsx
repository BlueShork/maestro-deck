// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { useToastStore, type Toast, type ToastVariant } from "@/stores/toastStore";

interface VariantLook {
  label: string;
  /** Tailwind classes for the square status pip. */
  pip: string;
  /** Colour of the time bar burning down at the bottom. */
  bar: string;
  /** Auto-dismiss delay; the bar burns for exactly this long. */
  duration: number;
  compact: boolean;
}

const looks: Record<ToastVariant, VariantLook> = {
  default: { label: "Info", pip: "bg-brand", bar: "bg-brand", duration: 4500, compact: false },
  success: {
    label: "Done",
    pip: "step-pip step-pip-done",
    bar: "bg-success",
    duration: 1800,
    compact: true,
  },
  error: {
    label: "Error",
    pip: "step-pip step-pip-failed",
    bar: "bg-destructive",
    duration: 4500,
    compact: false,
  },
  action: { label: "", pip: "", bar: "bg-primary-foreground", duration: 1400, compact: true },
};

/** Exit animation length; the store drops the toast once it has played. */
const EXIT_MS = 180;

/**
 * Toasts in the landing's card language: the cookie-banner card (base tone,
 * hairline edge, deep shadow), a Space Mono status row with a square pip, the
 * title in Inter Tight and the CI demo's stepped bar burning down the delay.
 * Hovering pauses the bar, and with it the dismissal.
 */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const setClosed = useToastStore((s) => s.setClosed);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[999] flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onClosed={() => setClosed(t.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast: t, onClosed }: { toast: Toast; onClosed: () => void }) {
  const look = looks[t.variant];
  const [leaving, setLeaving] = useState(false);
  const closedRef = useRef(false);

  const close = () => setLeaving(true);

  // The store closes a toast by flipping `open` (dismiss, or a newer toast
  // taking its place): play the exit, then report back.
  useEffect(() => {
    if (!t.open) setLeaving(true);
  }, [t.open]);

  useEffect(() => {
    if (!leaving) return;
    const id = window.setTimeout(() => {
      if (closedRef.current) return;
      closedRef.current = true;
      onClosed();
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leaving, onClosed]);

  const isAction = t.variant === "action";
  const showDescription = !look.compact && t.description;
  const timed = !t.persistent;

  return (
    <div
      role={t.variant === "error" ? "alert" : "status"}
      onKeyDown={(e) => {
        if (e.key === "Escape") close();
      }}
      className={cn(
        "group/toast pointer-events-auto relative overflow-hidden rounded-lg border shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]",
        isAction
          ? "border-transparent bg-primary text-primary-foreground"
          : "border-border bg-background text-foreground",
        look.compact ? "w-[300px]" : "w-[356px]",
        leaving
          ? "animate-out fade-out-0 slide-out-to-bottom-2 fill-mode-forwards duration-150"
          : "animate-in fade-in-0 slide-in-from-bottom-2 duration-200",
      )}
    >
      <div className={cn("flex items-start gap-3", look.compact ? "px-3 py-2.5" : "p-4")}>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {!isAction ? (
            <span className="mono-label flex items-center gap-2 text-[10px]">
              {t.persistent ? (
                <span aria-hidden className="step-pip step-pip-running" />
              ) : (
                <span aria-hidden className={cn("h-3 w-3 shrink-0", look.pip)} />
              )}
              {t.persistent ? "Working" : look.label}
            </span>
          ) : null}
          <span
            className={cn(
              "font-display font-medium leading-snug tracking-[-0.02em]",
              look.compact ? "text-[13px]" : "text-[15px]",
            )}
          >
            {t.title}
          </span>
          {showDescription ? (
            <span className="allow-select break-words text-xs leading-relaxed text-muted-foreground">
              {t.description}
            </span>
          ) : null}
          {t.action ? (
            <button
              type="button"
              onClick={() => {
                t.action?.onClick();
                close();
              }}
              className="mt-1 self-start font-mono text-[11px] uppercase text-brand transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {t.action.label}
            </button>
          ) : null}
        </div>
        {t.variant === "error" || t.variant === "default" ? (
          <button
            type="button"
            onClick={close}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {timed ? (
        <span
          aria-hidden
          onAnimationEnd={close}
          className={cn(
            "toast-bar absolute inset-x-0 bottom-0 h-0.5 origin-left group-hover/toast:[animation-play-state:paused]",
            look.bar,
          )}
          style={{ animationDuration: `${look.duration}ms` }}
        />
      ) : null}
    </div>
  );
}
