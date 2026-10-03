// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { X } from "lucide-react";
import { forwardRef, useContext, type ButtonHTMLAttributes, type ReactNode } from "react";

import { PanelCloseContext } from "@/components/panelClose";
import { cn } from "@/lib/utils";

/** Height shared by every panel header, so the hairlines line up across panels. */
const PANEL_HEADER_H = "h-10";

/**
 * Header row of a workspace panel, cut like the landing nav: a Space Mono
 * label on the left, then the panel's actions as full-height hairline cells
 * pinned to the right edge.
 */
export function PanelHeader({
  title,
  meta,
  children,
  className,
}: {
  title: ReactNode;
  /** Small inline status next to the title (counts, run state…). */
  meta?: ReactNode;
  /** Actions — usually `PanelAction`s, or any control that fits the row. */
  children?: ReactNode;
  className?: string;
}) {
  const close = useContext(PanelCloseContext);
  return (
    <div
      className={cn(
        "flex shrink-0 items-stretch border-b border-border bg-background",
        PANEL_HEADER_H,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-3">
        <span className="mono-label truncate">{title}</span>
        {meta}
      </div>
      <div className="flex shrink-0 items-stretch">
        {children}
        {close ? (
          <PanelAction
            onClick={close}
            title="Close panel"
            aria-label="Close panel"
            // Takes no room until the panel is hovered, so narrow panels keep
            // their title and actions.
            className="w-0 overflow-hidden border-l-0 opacity-0 transition-[width,opacity] group-hover/panel:w-8 group-hover/panel:border-l group-hover/panel:opacity-100 focus-visible:w-8 focus-visible:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </PanelAction>
        ) : null}
      </div>
    </div>
  );
}

/** One square action cell of a panel header. */
export const PanelAction = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; wide?: boolean }
>(({ active, wide, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "relative flex items-center justify-center gap-1.5 border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
      wide ? "whitespace-nowrap px-3 text-xs font-medium" : "w-8",
      active && "bg-accent text-foreground shadow-[inset_0_-2px_0_hsl(var(--brand))]",
      className,
    )}
    {...props}
  />
));
PanelAction.displayName = "PanelAction";
