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
