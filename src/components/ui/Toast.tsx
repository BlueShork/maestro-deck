import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { useToastStore, type ToastVariant } from "@/stores/toastStore";

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border bg-popover/90 text-popover-foreground",
  success:
    "border-emerald-500/25 bg-background/85 text-emerald-200 before:content-[''] before:h-1.5 before:w-1.5 before:rounded-full before:bg-emerald-400 before:shrink-0 before:mt-1.5",
  error: "border-destructive/60 bg-destructive/15 text-destructive-foreground",
  // Inverse-contrast snackbar: near-black pill in light theme, near-white
  // in dark theme. Used for transient device-action feedback.
  action: "border-transparent bg-foreground/90 text-background",
};

const variantSize: Record<ToastVariant, string> = {
  default: "max-w-sm p-3 text-sm",
  success: "max-w-xs py-1.5 px-2.5 text-xs",
  error: "max-w-sm p-3 text-sm",
  action: "max-w-xs py-1.5 px-3 text-xs",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const setClosed = useToastStore((s) => s.setClosed);

  useEffect(() => {
    const open = toasts.filter((t) => t.open);
    if (open.length === 0) return;
    const timers = open
      .filter((t) => !t.persistent)
      .map((t) => {
        const delay = t.variant === "action" ? 1400 : t.variant === "success" ? 1800 : 4500;
        return setTimeout(() => dismiss(t.id), delay);
      });
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, dismiss]);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          open={t.open}
          onOpenChange={(open) => {
            if (!open) {
              dismiss(t.id);
              // Radix completes its close animation before unmounting; remove
              // from the store after the swap delay.
              setTimeout(() => setClosed(t.id), 200);
            }
          }}
          className={cn(
            "pointer-events-auto flex w-full items-start gap-2 rounded-md border shadow-lg backdrop-blur data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-2",
            variantSize[t.variant],
            variantStyles[t.variant],
          )}
        >
          <div className="min-w-0 flex-1">
            <ToastPrimitive.Title
              className={cn(
                t.variant === "success" || t.variant === "action" ? "font-normal" : "font-medium",
              )}
            >
              {t.title}
            </ToastPrimitive.Title>
            {t.description && t.variant !== "success" && t.variant !== "action" ? (
              <ToastPrimitive.Description className="mt-0.5 text-xs opacity-80">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          {t.variant !== "success" && t.variant !== "action" ? (
            <ToastPrimitive.Close className="opacity-60 transition-opacity hover:opacity-100">
              <X className="h-3.5 w-3.5" />
            </ToastPrimitive.Close>
          ) : null}
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[60] flex max-w-full flex-col items-end gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
