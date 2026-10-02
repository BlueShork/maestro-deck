// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { PixelIcon, PixelWordmark } from "@/components/brand/Pixel";
import { cn } from "@/lib/utils";

/** "Maestro Deck" pixel lockup in the landing's warm bands. */
export function Logo({ className }: { className?: string }) {
  return <PixelWordmark className={cn("w-auto", className)} />;
}

/** The lockup followed by a Space Mono "Cloud" chip, as on the landing. */
export function LogoCloud({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2", className)}
      role="img"
      aria-label="Maestro Deck Cloud"
    >
      <PixelIcon size={18} />
      <span className="font-display text-sm font-medium tracking-tight text-foreground">
        Maestro Deck
      </span>
      <span className="bg-brand px-1.5 py-0.5 font-mono text-[10px] uppercase leading-none text-brand-foreground">
        Cloud
      </span>
    </span>
  );
}
