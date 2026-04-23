import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useEffect } from "react";

import { cn } from "@/lib/utils";
import { useToastStore, type ToastVariant } from "@/stores/toastStore";

const variantStyles: Record<ToastVariant, string> = {
  default: "border-border bg-popover text-popover-foreground",
  success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
  error: "border-destructive/60 bg-destructive/15 text-destructive-foreground",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => dismiss(t.id), 4500),
    );
    return () => {
      timers.forEach(clearTimeout);
    };
  }, [toasts, dismiss]);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {toasts.map((t) => (
        <ToastPrimitive.Root
          key={t.id}
          open
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
          className={cn(
            "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border p-3 text-sm shadow-lg backdrop-blur data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:slide-in-from-right-full",
            variantStyles[t.variant],
          )}
        >
          <div className="min-w-0 flex-1">
            <ToastPrimitive.Title className="font-medium">
              {t.title}
            </ToastPrimitive.Title>
            {t.description ? (
              <ToastPrimitive.Description className="mt-0.5 text-xs opacity-80">
                {t.description}
              </ToastPrimitive.Description>
            ) : null}
          </div>
          <ToastPrimitive.Close className="opacity-60 transition-opacity hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed right-4 top-4 z-[60] flex w-96 max-w-full flex-col gap-2 outline-none" />
    </ToastPrimitive.Provider>
  );
}
