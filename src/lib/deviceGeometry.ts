// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { UINode } from "@/types";

function nodeArea(n: UINode): number {
  const w = n.bounds.right - n.bounds.left;
  const h = n.bounds.bottom - n.bounds.top;
  return Math.max(0, w) * Math.max(0, h);
}

function contains(n: UINode, x: number, y: number): boolean {
  const { bounds } = n;
  return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
}

function isTargetable(n: UINode): boolean {
  return !!n.text?.trim() || !!n.resource_id?.trim() || !!n.content_desc?.trim() || n.clickable;
}

/**
 * Walk the full tree and return the best node containing (x, y). "Best" = the
 * smallest-area node, but with a preference for nodes that have a usable
 * selector (text / resource-id / content-desc / clickable). Falls back to the
 * smallest raw match if no targetable candidate exists.
 *
 * We walk unconditionally instead of pruning on "does parent contain point"
 * because Maestro 2.0 returns the root with empty attributes → bounds parse
 * to [0,0][0,0], which would cut the descent and return null.
 */
export function findSmallestAt(root: UINode, x: number, y: number): UINode | null {
  let bestTargetable: UINode | null = null;
  let bestTargetableArea = Infinity;
  let bestAny: UINode | null = null;
  let bestAnyArea = Infinity;
  const stack: UINode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (contains(n, x, y)) {
      const area = nodeArea(n);
      if (area > 0 && area < bestAnyArea) {
        bestAny = n;
        bestAnyArea = area;
      }
      if (area > 0 && area < bestTargetableArea && isTargetable(n)) {
        bestTargetable = n;
        bestTargetableArea = area;
      }
    }
    for (const c of n.children) stack.push(c);
  }
  return bestTargetable ?? bestAny;
}

/**
 * The coordinate space the hierarchy's bounds are expressed in: the furthest
 * right/bottom edge of any node. Maestro reports bounds in the device's native
 * resolution, which can differ from the (downscaled) stream. Null when the
 * tree carries no usable bounds.
 */
export function hierarchyExtent(root: UINode | null): { w: number; h: number } | null {
  if (!root) return null;
  let w = 0;
  let h = 0;
  const stack: UINode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.bounds.right > w) w = n.bounds.right;
    if (n.bounds.bottom > h) h = n.bounds.bottom;
    for (const c of n.children) stack.push(c);
  }
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Scale that fits a device frame inside a container, preserving its ratio. */
export function fitScale(
  container: { width: number; height: number },
  device: { width: number; height: number },
): number {
  if (device.width <= 0 || device.height <= 0) return 0;
  return Math.max(0, Math.min(container.width / device.width, container.height / device.height));
}

/**
 * Map a point relative to the container's top-left corner onto device
 * (stream) pixels, given a frame of `display` size centred in the container.
 * Null when the point falls outside the frame.
 */
export function toDevicePoint(
  local: { x: number; y: number },
  container: { width: number; height: number },
  display: { width: number; height: number },
  scale: number,
): { x: number; y: number } | null {
  if (scale <= 0) return null;
  const x = local.x - (container.width - display.width) / 2;
  const y = local.y - (container.height - display.height) / 2;
  if (x < 0 || y < 0 || x > display.width || y > display.height) return null;
  return { x: Math.round(x / scale), y: Math.round(y / scale) };
}

/**
 * End point of the swipe that stands in for a wheel scroll at `cursor`.
 * Scrolling down (positive delta, display pixels) drags the finger up so the
 * content below comes into view; the result stays on screen.
 */
export function wheelSwipeEndY(
  cursorY: number,
  displayDelta: number,
  scale: number,
  deviceHeight: number,
): number {
  return Math.max(0, Math.min(deviceHeight - 1, cursorY - Math.round(displayDelta / scale)));
}

export type SwipeDirection = "up" | "down" | "left" | "right";

export interface ToolbarSwipe {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  duration_ms: number;
}

/**
 * Swipe sent by the device toolbar's arrow buttons, in stream space. The
 * finger moves against the arrow so the content on that side comes into
 * view. Vertical swipes are a slow 30 % → 70 % drag so lists scroll without
 * flinging; horizontal ones sweep 10 % → 90 % fast enough for launchers and
 * carousels to read them as a page change.
 */
export function toolbarSwipe(
  direction: SwipeDirection,
  deviceWidth: number,
  deviceHeight: number,
): ToolbarSwipe {
  const cx = Math.round(deviceWidth / 2);
  const cy = Math.round(deviceHeight / 2);
  const at = (size: number, ratio: number) => Math.round(size * ratio);
  switch (direction) {
    case "up":
      return {
        x1: cx,
        y1: at(deviceHeight, 0.3),
        x2: cx,
        y2: at(deviceHeight, 0.7),
        duration_ms: 300,
      };
    case "down":
      return {
        x1: cx,
        y1: at(deviceHeight, 0.7),
        x2: cx,
        y2: at(deviceHeight, 0.3),
        duration_ms: 300,
      };
    case "left":
      return {
        x1: at(deviceWidth, 0.1),
        y1: cy,
        x2: at(deviceWidth, 0.9),
        y2: cy,
        duration_ms: 150,
      };
    case "right":
      return {
        x1: at(deviceWidth, 0.9),
        y1: cy,
        x2: at(deviceWidth, 0.1),
        y2: cy,
        duration_ms: 150,
      };
  }
}
