import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { usePanelsStore, type PanelId } from "@/stores/panelsStore";

/**
 * Wraps a resizable panel's content with a tiny close affordance in the
 * top-right corner. Hover-only so it doesn't clutter the UI; clicking
 * hides the panel (user can restore via the Toolbar's View menu).
 *
 * We keep this intentionally minimal — no title bar, no drag handle,
 * no tabs. Each child component already owns its own header
 * styling/content; the × just floats over it.
 */
export function PanelShell({
  id,
  children,
  className,
}: {
  id: PanelId;
  children: ReactNode;
  className?: string;
}) {
  const hide = usePanelsStore((s) => s.hide);
  return (
    <div
      className={cn("group/panel relative flex h-full min-h-0 w-full min-w-0 flex-col", className)}
    >
      {children}
      <button
        type="button"
        onClick={() => hide(id)}
        title="Close panel"
        aria-label="Close panel"
        // Visible on hover over the panel. `z-20` keeps it above
        // internal content like scrollbars and code-mirror gutters.
        className="absolute right-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded border border-border/0 bg-background/60 text-muted-foreground opacity-0 shadow-sm backdrop-blur transition hover:border-border hover:bg-background hover:text-foreground group-hover/panel:opacity-100"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
