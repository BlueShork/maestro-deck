// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { CircleAlert, CircleCheck, Info, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import SwipeToast from "@/components/ui/SwipeToast";
import { useToastStore, type Toast, type ToastVariant } from "@/stores/toastStore";

interface VariantLook {
  background: string;
  color: string;
  fuseColor: string;
  width: number;
  /** Auto-dismiss delay; the fuse burns for exactly this long. */
  duration: number;
  compact: boolean;
}

const looks: Record<ToastVariant, VariantLook> = {
  default: {
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    fuseColor: "hsl(var(--muted-foreground))",
    width: 356,
    duration: 4500,
    compact: false,
  },
  success: {
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    fuseColor: "#34d399",
    width: 300,
    duration: 1800,
    compact: true,
  },
  error: {
    background: "hsl(var(--popover))",
    color: "hsl(var(--popover-foreground))",
    fuseColor: "hsl(var(--destructive))",
    width: 356,
    duration: 4500,
    compact: false,
  },
  // Inverse-contrast snackbar: near-black in light theme, near-white in dark
  // theme. Used for transient device-action feedback.
  action: {
    background: "hsl(var(--foreground))",
    color: "hsl(var(--background))",
    fuseColor: "hsl(var(--background))",
    width: 300,
    duration: 1400,
    compact: true,
  },
};

function iconFor(t: Toast): ReactNode {
  if (t.persistent) return <LoaderCircle className="animate-spin" />;
  switch (t.variant) {
    case "success":
      return <CircleCheck className="text-emerald-400" />;
    case "error":
      return <CircleAlert className="text-destructive" />;
    case "default":
      return <Info className="opacity-70" />;
    case "action":
      return null;
  }
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const setClosed = useToastStore((s) => s.setClosed);

  // SwipeToast owns the timer (paused on hover), the swipe-to-dismiss and the
  // exit animation; it reports back through onClose once it has left the
  // screen, and only then do we drop it from the store.
  return (
    <>
      {toasts.map((t) => {
        const look = looks[t.variant];
        return (
          <SwipeToast
            key={t.id}
            open={t.open}
            onClose={() => setClosed(t.id)}
            title={t.title}
            description={t.variant === "success" || t.variant === "action" ? "" : t.description}
            icon={iconFor(t)}
            background={look.background}
            color={look.color}
            fuseColor={look.fuseColor}
            width={look.width}
            duration={t.persistent ? 0 : look.duration}
            closeButton={t.variant === "error" || t.variant === "default"}
            className={look.compact ? "swipe-toast--compact" : ""}
          />
        );
      })}
    </>
  );
}
