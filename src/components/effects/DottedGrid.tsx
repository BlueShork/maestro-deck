// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { type CSSProperties, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const DOT_SPACING = 24;
const DOT_RADIUS = 1.5;

export function DottedGrid({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn("relative overflow-hidden bg-muted/30", className)}
      style={{
        backgroundImage: `radial-gradient(hsl(var(--muted-foreground) / 0.35) ${DOT_RADIUS}px, transparent ${DOT_RADIUS + 0.5}px)`,
        backgroundSize: `${DOT_SPACING}px ${DOT_SPACING}px`,
        backgroundPosition: `${DOT_SPACING / 2}px ${DOT_SPACING / 2}px`,
        ...style,
      }}
    >
      {children ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
          {children}
        </div>
      ) : null}
    </div>
  );
}
