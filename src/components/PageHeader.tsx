// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { PixelChevron, PixelIcon } from "@/components/brand/Pixel";

/**
 * Header bar of the full-screen pages (settings, account, image bank), cut
 * into cells like the landing nav: back, brand, then a Space Mono breadcrumb
 * ending on the current page in orange.
 */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const navigate = useNavigate();
  return (
    <header className="flex h-12 shrink-0 items-stretch border-b border-border bg-background">
      <button
        type="button"
        onClick={() => navigate("/")}
        aria-label="Back to workspace"
        title="Back to workspace (Esc)"
        className="group flex w-12 shrink-0 items-center justify-center border-r border-border text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <PixelChevron
          direction="left"
          className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:-translate-x-[3px]"
        />
      </button>
      <div className="flex min-w-0 items-center gap-3 border-r border-border px-4">
        <PixelIcon size={20} />
        <nav
          aria-label="Breadcrumb"
          className="flex items-center gap-2 font-mono text-[11px] uppercase"
        >
          <button
            type="button"
            onClick={() => navigate("/")}
            className="uppercase text-muted-foreground transition-colors hover:text-foreground"
          >
            Home
          </button>
          <span className="text-muted-foreground">/</span>
          <span aria-current="page" className="truncate text-brand">
            {title}
          </span>
        </nav>
      </div>
      {children}
    </header>
  );
}

/** Large Inter Tight page title, the landing's `.page_hero_title`. */
export function PageTitle({
  title,
  description,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  className?: string;
}) {
  return (
    <header className={className ?? "flex flex-col gap-2"}>
      <h1 className="font-display text-[34px] font-medium leading-none tracking-[-0.045em] text-foreground">
        {title}
      </h1>
      {description ? (
        <p className="text-[13px] leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
    </header>
  );
}
