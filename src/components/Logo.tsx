// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Horizontal "Maestro Deck" logo (icon + wordmark) using `currentColor` so it
 * follows the surrounding text color in both light and dark themes.
 */
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1600 400"
      fontFamily="Inter, -apple-system, Helvetica, Arial, sans-serif"
      className={cn("text-foreground", className)}
      aria-label="Maestro Deck"
      role="img"
      {...props}
    >
      <g transform="translate(40, 40) scale(0.3125)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M256 64C150.02 64 64 150.02 64 256V768C64 873.98 150.02 960 256 960H768C873.98 960 960 873.98 960 768V256C960 150.02 873.98 64 768 64H256ZM320 256C284.654 256 256 284.654 256 320V704C256 739.346 284.654 768 320 768H704C739.346 768 768 739.346 768 704V320C768 284.654 739.346 256 704 256H320Z"
        />
        <rect x="336" y="336" width="352" height="352" rx="24" ry="24" fill="currentColor" />
      </g>
      <text
        x="420"
        y="200"
        dominantBaseline="central"
        fontSize="180"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="-4"
      >
        Maestro Deck
      </text>
    </svg>
  );
}

/**
 * The same lockup with the CLOUD pill, ported from the brand asset the docs
 * site serves (maestro-nightly/landing_new/public/brand/logo-horizontal-white-cloud.svg).
 * Only difference: `currentColor` instead of the asset's hard-coded white, so
 * it works on the app's light theme too. Geometry is untouched — keep it that
 * way so the mark stays identical to the one on the site.
 */
export function LogoCloud({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1600 420"
      fontFamily="Inter, -apple-system, Helvetica, Arial, sans-serif"
      className={cn("text-foreground", className)}
      aria-label="Maestro Deck Cloud"
      role="img"
      {...props}
    >
      <g transform="translate(40, 40) scale(0.3125)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M256 64C150.02 64 64 150.02 64 256V768C64 873.98 150.02 960 256 960H768C873.98 960 960 873.98 960 768V256C960 150.02 873.98 64 768 64H256ZM320 256C284.654 256 256 284.654 256 320V704C256 739.346 284.654 768 320 768H704C739.346 768 768 739.346 768 704V320C768 284.654 739.346 256 704 256H320Z"
        />
        <rect x="336" y="336" width="352" height="352" rx="24" ry="24" fill="currentColor" />
      </g>
      <text
        x="420"
        y="200"
        dominantBaseline="central"
        fontSize="180"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="-4"
      >
        Maestro Deck
      </text>
      <rect
        x="1264"
        y="312"
        width="280"
        height="76"
        rx="38"
        ry="38"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
      />
      <text
        x="1404"
        y="351"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize="40"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="6"
      >
        CLOUD
      </text>
    </svg>
  );
}
