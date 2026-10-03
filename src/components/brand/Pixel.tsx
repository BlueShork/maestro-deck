// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Pixel brand kit shared with the landing (maestrodeck.cloud): the banded
 * icon, the bitmap wordmark, the stepped chevron used on every call to action
 * and the warm block mosaic.
 */

// Warm gradient, top to bottom, applied as horizontal bands.
const BANDS = ["#FFD800", "#FFAF00", "#FF8205", "#FA500F", "#E10500"];

type Cell = { x: number; y: number };

// Pixel take on the app icon: a frame, a gap, then a solid core.
function iconCells(frame: number, gap: number, core: number, cornerTrim: number): Cell[] {
  const size = 2 * (frame + gap) + core;
  const last = size - 1;
  const cells: Cell[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.min(x, last - x);
      const dy = Math.min(y, last - y);
      const inFrame = dx < frame || dy < frame;
      const inCore = dx >= frame + gap && dy >= frame + gap;
      // Trim the outer corners so the frame keeps its rounded silhouette.
      const corner = dx + dy < cornerTrim;
      if ((inFrame && !corner) || inCore) cells.push({ x, y });
    }
  }
  return cells;
}

const ICON_SIZE = 16;
const ICON_CELLS = iconCells(3, 2, 6, 2);
// The compact 9-cell grid stays crisp at toolbar sizes, where 16 cells blur.
const COMPACT_ICON_SIZE = 9;
const COMPACT_ICON_CELLS = iconCells(2, 1, 3, 1);

// 5×7 bitmap glyphs for the wordmark.
const GLYPHS: Record<string, string[]> = {
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  " ": ["000", "000", "000", "000", "000", "000", "000"],
};
const GLYPH_HEIGHT = 7;

function textCells(text: string): { cells: Cell[]; width: number } {
  const cells: Cell[] = [];
  let cursor = 0;
  for (const char of text.toUpperCase()) {
    const rows = GLYPHS[char];
    if (!rows) continue;
    rows.forEach((row, y) =>
      [...row].forEach((bit, x) => {
        if (bit === "1") cells.push({ x: cursor + x, y });
      }),
    );
    cursor += rows[0].length + 1;
  }
  return { cells, width: cursor - 1 };
}

function bandColor(y: number, height: number) {
  return BANDS[Math.min(BANDS.length - 1, Math.floor((y / height) * BANDS.length))];
}

// One path per colour band: adjacent squares in a single path rasterise
// without the hairline seams separate <rect>s show at fractional scales.
function Pixels({
  cells,
  height,
  dx = 0,
  dy = 0,
  color,
}: {
  cells: Cell[];
  height: number;
  dx?: number;
  dy?: number;
  color?: string;
}) {
  const groups = new Map<string, string>();
  for (const { x, y } of cells) {
    const fill = color ?? bandColor(y, height);
    groups.set(fill, `${groups.get(fill) ?? ""}M${x + dx} ${y + dy}h1v1h-1z`);
  }
  return [...groups].map(([fill, d]) => <path key={fill} d={d} fill={fill} />);
}

export function PixelIcon({
  size = 24,
  className,
  color,
  compact = true,
}: {
  size?: number;
  className?: string;
  /** Solid fill instead of the warm bands. */
  color?: string;
  compact?: boolean;
}) {
  const grid = compact ? COMPACT_ICON_SIZE : ICON_SIZE;
  return (
    <svg
      className={cn("block shrink-0", className)}
      viewBox={`0 0 ${grid} ${grid}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Maestro Deck"
    >
      <Pixels cells={compact ? COMPACT_ICON_CELLS : ICON_CELLS} height={grid} color={color} />
    </svg>
  );
}

/** Icon + bitmap text on one pixel grid, so both share pixel size and bands. */
export function PixelWordmark({
  text = "Maestro Deck",
  className,
  color,
}: {
  text?: string;
  className?: string;
  color?: string;
}) {
  const { cells, width } = textCells(text);
  const gap = 3;
  const textOffset = COMPACT_ICON_SIZE + gap;
  const textTop = (COMPACT_ICON_SIZE - GLYPH_HEIGHT) / 2;
  return (
    <svg
      className={cn("block h-auto", className)}
      viewBox={`0 0 ${textOffset + width} ${COMPACT_ICON_SIZE}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={text}
    >
      <Pixels cells={COMPACT_ICON_CELLS} height={COMPACT_ICON_SIZE} color={color} />
      <Pixels cells={cells} height={GLYPH_HEIGHT} dx={textOffset} dy={textTop} color={color} />
    </svg>
  );
}

/** Pixel-art arrow used on calls to action. */
export function PixelChevron({
  direction = "right",
  size = 12,
  className,
}: {
  direction?: "right" | "down" | "left" | "up";
  size?: number;
  className?: string;
}) {
  const rotate = { right: 0, down: 90, left: 180, up: 270 }[direction];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 6 6"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={cn("shrink-0", className)}
      style={rotate ? { transform: `rotate(${rotate}deg)` } : undefined}
    >
      <path d="M1 0h1v1H1zM2 1h1v1H2zM3 2h1v2H3zM2 4h1v1H2zM1 5h1v1H1z" fill="currentColor" />
    </svg>
  );
}

/** Pixel "open in new" arrow (up-right), marks links that leave the app. */
export function PixelExternal({ className }: { className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 7 7"
      aria-hidden="true"
      shapeRendering="crispEdges"
      className={cn("shrink-0", className)}
    >
      <path d="M2 0h5v5H6V2H5v1H4v1H3v1H2v1H1v1H0V6h1V5h1V4h1V3h1V2h1V1H2z" fill="currentColor" />
    </svg>
  );
}

const PALETTES = {
  orange: ["#FA500F", "#FF8205", "#FA500F", "#FF6A00", "#E10500", "#FFAF00"],
  red: ["#E10500", "#C4001D", "#E61300", "#FA500F", "#B3001A"],
  yellow: ["#FFD800", "#FFAF00", "#FFC23A", "#FF8205", "#FBD679"],
  dark: ["#141418", "#17171c", "#1a1a1e", "#1d1d22", "#121215"],
  paper: ["#f3f1ea", "#efece4", "#f6f4ee", "#ebe8df", "#f1eee6"],
} as const;

export type Palette = keyof typeof PALETTES;

// Small seeded PRNG so every render draws the same mosaic.
function prng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Block mosaic background: a grid of warm tiles, a few diamonds, and a share
 * of tiles that slowly swap colour. Children are laid over it.
 */
export function PixelMosaic({
  cols,
  rows,
  palette = "orange",
  seed = 1,
  className,
  children,
}: {
  cols: number;
  rows: number;
  palette?: Palette;
  seed?: number;
  className?: string;
  children?: ReactNode;
}) {
  const colors = PALETTES[palette];
  const rand = prng(seed);
  const pick = () => colors[Math.floor(rand() * colors.length)];

  const tiles: ReactNode[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const a = pick();
      const flicker = rand() < 0.14;
      const diamond = rand() < 0.05;
      const b = pick();
      tiles.push(
        <rect
          key={`t${x}-${y}`}
          x={x}
          y={y}
          width={1}
          height={1}
          fill={a}
          className={flicker ? "pixel-flicker" : undefined}
          style={
            flicker
              ? ({
                  "--a": a,
                  "--b": b,
                  animationDelay: `${(rand() * 6).toFixed(2)}s`,
                  animationDuration: `${(4 + rand() * 5).toFixed(2)}s`,
                } as CSSProperties)
              : undefined
          }
        />,
      );
      if (diamond) {
        tiles.push(
          <polygon
            key={`d${x}-${y}`}
            points={`${x + 0.5},${y + 0.1} ${x + 0.9},${y + 0.5} ${x + 0.5},${y + 0.9} ${x + 0.1},${y + 0.5}`}
            fill={b === a ? colors[0] : b}
          />,
        );
      }
    }
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${cols} ${rows}`}
        preserveAspectRatio="xMidYMid slice"
        shapeRendering="crispEdges"
        aria-hidden="true"
      >
        {tiles}
      </svg>
      {children}
    </div>
  );
}
