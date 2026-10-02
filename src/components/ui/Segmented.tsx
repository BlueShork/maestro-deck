// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface SegmentedItem<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

/**
 * Exclusive choice drawn like the landing nav: hairline-separated cells inside
 * one border, the active cell lit with a ghost fill and an orange underline.
 */
export function Segmented<T extends string>({
  items,
  value,
  onChange,
  size = "default",
  className,
  "aria-label": ariaLabel,
}: {
  items: SegmentedItem<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "default";
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn("inline-flex overflow-hidden rounded-md border border-border", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-pressed={active}
            className={cn(
              "flex items-center justify-center gap-1.5 border-l border-border font-medium transition-colors first:border-l-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
              size === "sm" ? "h-6 px-2.5 text-[11px]" : "h-8 px-3 text-xs",
              active
                ? "bg-accent text-foreground shadow-[inset_0_-2px_0_hsl(var(--brand))]"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
