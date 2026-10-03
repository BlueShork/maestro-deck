// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useId, type ReactNode } from "react";

import type { CatalogKind, CatalogSource } from "@/lib/deviceCatalog";
import { cn } from "@/lib/utils";
import type { Platform } from "@/types";

/**
 * Device illustrations in the landing's pixel language. The screen is a tiny
 * block mosaic whose palette says where the device lives (orange: this
 * machine, red: the farm, yellow: the cloud); a simulator is drawn inside a
 * desktop window (the landing's three-square title bar) so it never reads as
 * a phone in your hand; the web target is a browser window.
 */

const PALETTES: Record<CatalogSource | "off", string[]> = {
  local: ["#FA500F", "#FF8205", "#FF6A00", "#E10500", "#FFAF00"],
  farm: ["#E10500", "#C4001D", "#E61300", "#FA500F", "#B3001A"],
  cloud: ["#FFD800", "#FFAF00", "#FFC23A", "#FF8205", "#FBD679"],
  off: ["#2a2a30", "#232328", "#303036", "#26262b", "#1f1f24"],
};

function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Block mosaic filling a rectangle, drawn in `cell`-sized squares. */
function Mosaic({
  x,
  y,
  w,
  h,
  cell,
  colors,
  seed,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: number;
  colors: string[];
  seed: number;
}) {
  const rand = prng(seed);
  const cols = Math.ceil(w / cell);
  const rows = Math.ceil(h / cell);
  const groups = new Map<string, string>();
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const fill = colors[Math.floor(rand() * colors.length)];
      const cw = Math.min(cell, w - i * cell);
      const ch = Math.min(cell, h - j * cell);
      groups.set(
        fill,
        `${groups.get(fill) ?? ""}M${x + i * cell} ${y + j * cell}h${cw}v${ch}h${-cw}z`,
      );
    }
  }
  return (
    <>
      {[...groups].map(([fill, d]) => (
        <path key={fill} d={d} fill={fill} />
      ))}
    </>
  );
}

/** Body width of a phone vs a tablet; both are 112 tall. */
const BODY_W = { phone: 60, tablet: 84 } as const;

/** Phone / tablet body with its screen, in a `w`×112 box. */
function Handset({
  platform,
  tablet,
  screen,
}: {
  platform: Platform;
  tablet: boolean;
  screen: ReactNode;
}) {
  const ios = platform === "ios";
  const clipId = useId();
  const w = tablet ? BODY_W.tablet : BODY_W.phone;
  const mid = w / 2;
  return (
    <>
      <rect
        x="1"
        y="1"
        width={w - 2}
        height="110"
        rx={ios ? (tablet ? 7 : 11) : 7}
        className="fill-background stroke-foreground/70"
        strokeWidth="2"
      />
      <clipPath id={clipId}>
        <rect x="5" y="5" width={w - 10} height="102" rx={ios && !tablet ? 8 : 4} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>{screen}</g>
      {tablet ? (
        // Front camera in the bezel.
        <rect x={mid - 1.5} y="2" width="3" height="2" className="fill-foreground/50" />
      ) : ios ? (
        // Dynamic Island.
        <rect x={mid - 8} y="8" width="16" height="5" rx="2.5" className="fill-background" />
      ) : (
        // Punch-hole camera.
        <rect x={mid - 2} y="8" width="4" height="4" className="fill-background" />
      )}
      {/* Side buttons. */}
      <rect x={w - 1} y="26" width="1.5" height="10" className="fill-foreground/70" />
      {ios && !tablet ? (
        <rect x="-0.5" y="22" width="1.5" height="7" className="fill-foreground/70" />
      ) : null}
    </>
  );
}

export function DeviceArt({
  platform,
  kind,
  source,
  dim = false,
  seedKey,
  tablet = false,
  className,
}: {
  platform: Platform;
  /** Draw a tablet instead of a phone. */
  tablet?: boolean;
  kind: CatalogKind;
  source: CatalogSource;
  /** Shut down / offline: the screen goes dark. */
  dim?: boolean;
  /** Stable string (the entry id) so each device keeps its own mosaic. */
  seedKey: string;
  className?: string;
}) {
  const colors = PALETTES[dim ? "off" : source];
  const seed = hash(seedKey);

  if (kind === "web") {
    return (
      <svg
        viewBox="0 0 120 84"
        className={cn("block", className)}
        shapeRendering="crispEdges"
        aria-hidden
      >
        <rect
          x="1"
          y="1"
          width="118"
          height="82"
          rx="4"
          className="fill-background stroke-foreground/70"
          strokeWidth="2"
        />
        <path d="M2 14h116" className="stroke-foreground/30" strokeWidth="1" />
        <rect x="7" y="6" width="3" height="3" className="fill-foreground/50" />
        <rect x="12" y="6" width="3" height="3" className="fill-foreground/50" />
        <rect x="17" y="6" width="3" height="3" className="fill-foreground/50" />
        <rect x="26" y="5" width="70" height="5" className="fill-foreground/15" />
        <Mosaic x={6} y={18} w={108} h={60} cell={6} colors={colors} seed={seed} />
      </svg>
    );
  }

  const bodyW = tablet ? BODY_W.tablet : BODY_W.phone;
  const screen = (
    <Mosaic x={5} y={5} w={bodyW - 10} h={102} cell={6.25} colors={colors} seed={seed} />
  );

  if (kind === "simulator") {
    // The phone sits in a desktop window: it runs on a computer.
    return (
      <svg viewBox={`0 0 ${bodyW + 36} 140`} className={cn("block", className)} aria-hidden>
        <rect
          x="1"
          y="1"
          width={bodyW + 34}
          height="138"
          rx="4"
          className="fill-surface stroke-foreground/40"
          strokeWidth="1.5"
        />
        <path d={`M2 13h${bodyW + 32}`} className="stroke-foreground/25" strokeWidth="1" />
        <rect x="7" y="5" width="3" height="3" className="fill-foreground/50" />
        <rect x="12" y="5" width="3" height="3" className="fill-foreground/50" />
        <rect x="17" y="5" width="3" height="3" className="fill-foreground/50" />
        <g transform="translate(18 21)">
          <Handset platform={platform} tablet={tablet} screen={screen} />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox={`-2 0 ${bodyW + 4} 112`} className={cn("block", className)} aria-hidden>
      <Handset platform={platform} tablet={tablet} screen={screen} />
    </svg>
  );
}
