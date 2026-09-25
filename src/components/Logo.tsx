// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useId, type SVGProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Horizontal "Maestro Deck" logo (icon + wordmark) using `currentColor` so it
 * follows the surrounding text color in both light and dark themes.
 */
export function Logo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1640 320"
      fontFamily="Manrope, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
      className={cn("text-foreground", className)}
      aria-label="Maestro Deck"
      role="img"
      {...props}
    >
      <g transform="translate(40 45) scale(0.2567) translate(-64 -64)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M256 64C150.02 64 64 150.02 64 256V768C64 873.98 150.02 960 256 960H768C873.98 960 960 873.98 960 768V256C960 150.02 873.98 64 768 64H256ZM320 256C284.654 256 256 284.654 256 320V704C256 739.346 284.654 768 320 768H704C739.346 768 768 739.346 768 704V320C768 284.654 739.346 256 704 256H320Z"
        />
        <rect x="336" y="336" width="352" height="352" rx="24" ry="24" fill="currentColor" />
      </g>
      <text
        x="350"
        y="160"
        dominantBaseline="central"
        fontSize="200"
        fontWeight="700"
        fill="currentColor"
        letterSpacing="-6"
      >
        Maestro Deck
      </text>
    </svg>
  );
}

/**
 * The same lockup followed by a solid "Cloud" pill (brand asset
 * maestro-deck-cloud-horizontal-*.svg). The pill's label is knocked out with a
 * mask instead of filled with a second color, so the lockup stays a single
 * `currentColor` and reads on both themes.
 */
export function LogoCloud({ className, ...props }: SVGProps<SVGSVGElement>) {
  const maskId = useId();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 2344 320"
      fontFamily="Manrope, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif"
      fontWeight="700"
      fontSize="200"
      letterSpacing="-6"
      className={cn("text-foreground", className)}
      aria-label="Maestro Deck Cloud"
      role="img"
      {...props}
    >
      <defs>
        <mask id={maskId}>
          <rect x="1680" y="52" width="624" height="216" rx="40" ry="40" fill="white" />
          <text
            x="1992"
            y="160"
            dominantBaseline="central"
            textAnchor="middle"
            textLength="540"
            lengthAdjust="spacingAndGlyphs"
            fill="black"
          >
            Cloud
          </text>
        </mask>
      </defs>
      <g transform="translate(40 45) scale(0.2567) translate(-64 -64)">
        <path
          fillRule="evenodd"
          clipRule="evenodd"
          fill="currentColor"
          d="M256 64C150.02 64 64 150.02 64 256V768C64 873.98 150.02 960 256 960H768C873.98 960 960 873.98 960 768V256C960 150.02 873.98 64 768 64H256ZM320 256C284.654 256 256 284.654 256 320V704C256 739.346 284.654 768 320 768H704C739.346 768 768 739.346 768 704V320C768 284.654 739.346 256 704 256H320Z"
        />
        <rect x="336" y="336" width="352" height="352" rx="24" ry="24" fill="currentColor" />
      </g>
      <text
        x="350"
        y="160"
        dominantBaseline="central"
        textLength="1280"
        lengthAdjust="spacingAndGlyphs"
        fill="currentColor"
      >
        Maestro Deck
      </text>
      <rect
        x="1680"
        y="52"
        width="624"
        height="216"
        rx="40"
        ry="40"
        fill="currentColor"
        mask={`url(#${maskId})`}
      />
    </svg>
  );
}
