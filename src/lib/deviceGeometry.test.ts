import { describe, expect, it } from "vitest";

import type { UINode } from "@/types";

import {
  findSmallestAt,
  fitScale,
  hierarchyExtent,
  toDevicePoint,
  toolbarSwipe,
  wheelSwipeEndY,
} from "./deviceGeometry";

let seq = 0;
function n(
  [left, top, right, bottom]: [number, number, number, number],
  over: Partial<UINode> = {},
  children: UINode[] = [],
): UINode {
  return {
    id: String(seq++),
    resource_id: null,
    text: null,
    content_desc: null,
    class_name: "android.view.View",
    package: "com.app",
    bounds: { left, top, right, bottom },
    clickable: false,
    enabled: true,
    focused: false,
    children,
    ...over,
  };
}

describe("findSmallestAt", () => {
  it("returns the smallest targetable node under the point", () => {
    const button = n([10, 10, 110, 60], { text: "Login" });
    const card = n([0, 0, 500, 300], { resource_id: "card" }, [button]);
    const root = n([0, 0, 1080, 2340], {}, [card]);
    expect(findSmallestAt(root, 50, 30)).toBe(button);
    expect(findSmallestAt(root, 400, 200)).toBe(card);
  });

  it("prefers a targetable node over a smaller anonymous one", () => {
    const icon = n([20, 20, 40, 40]);
    const button = n([10, 10, 110, 60], { clickable: true }, [icon]);
    const root = n([0, 0, 1080, 2340], {}, [button]);
    expect(findSmallestAt(root, 30, 30)).toBe(button);
  });

  it("falls back to the smallest node when nothing is targetable", () => {
    const inner = n([20, 20, 40, 40]);
    const outer = n([0, 0, 100, 100], {}, [inner]);
    expect(findSmallestAt(outer, 30, 30)).toBe(inner);
  });

  it("ignores whitespace-only text as a selector", () => {
    const blank = n([20, 20, 40, 40], { text: "   " });
    const labelled = n([0, 0, 100, 100], { content_desc: "Menu" }, [blank]);
    expect(findSmallestAt(labelled, 30, 30)).toBe(labelled);
  });

  it("descends through a root with empty [0,0][0,0] bounds (Maestro 2.0)", () => {
    const button = n([10, 10, 110, 60], { text: "OK" });
    const root = n([0, 0, 0, 0], {}, [n([0, 0, 1080, 2340], {}, [button])]);
    expect(findSmallestAt(root, 50, 30)).toBe(button);
  });

  it("treats edges as inside and returns null away from every node", () => {
    const button = n([10, 10, 110, 60], { text: "OK" });
    expect(findSmallestAt(button, 110, 60)).toBe(button);
    expect(findSmallestAt(button, 111, 60)).toBeNull();
  });

  it("skips zero-area nodes", () => {
    const line = n([0, 50, 100, 50], { text: "divider" });
    const box = n([0, 0, 100, 100], { text: "box" }, [line]);
    expect(findSmallestAt(box, 50, 50)).toBe(box);
  });

  it("handles a deep tree without recursion limits", () => {
    let leaf = n([10, 10, 20, 20], { text: "deep" });
    const deepest = leaf;
    for (let i = 0; i < 20_000; i++) leaf = n([0, 0, 1000, 1000], {}, [leaf]);
    expect(findSmallestAt(leaf, 15, 15)).toBe(deepest);
  });
});

describe("hierarchyExtent", () => {
  it("is the furthest right/bottom edge of any node", () => {
    const root = n([0, 0, 0, 0], {}, [n([0, 0, 1440, 3000]), n([0, 2900, 1200, 3120])]);
    expect(hierarchyExtent(root)).toEqual({ w: 1440, h: 3120 });
  });

  it("is null for no tree or a tree without bounds", () => {
    expect(hierarchyExtent(null)).toBeNull();
    expect(hierarchyExtent(n([0, 0, 0, 0]))).toBeNull();
  });
});

describe("fitScale", () => {
  it("fits by the tighter dimension", () => {
    expect(fitScale({ width: 540, height: 2000 }, { width: 1080, height: 2340 })).toBe(0.5);
    expect(fitScale({ width: 2000, height: 1170 }, { width: 1080, height: 2340 })).toBe(0.5);
  });

  it("is 0 for an unmeasured container or unknown device size", () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 1080, height: 2340 })).toBe(0);
    expect(fitScale({ width: 500, height: 500 }, { width: 0, height: 2340 })).toBe(0);
  });
});

describe("toDevicePoint", () => {
  const container = { width: 600, height: 1170 };
  const display = { width: 540, height: 1170 };
  const scale = 0.5;

  it("maps through the centring offset and the scale", () => {
    expect(toDevicePoint({ x: 30, y: 0 }, container, display, scale)).toEqual({ x: 0, y: 0 });
    expect(toDevicePoint({ x: 300, y: 585 }, container, display, scale)).toEqual({
      x: 540,
      y: 1170,
    });
    expect(toDevicePoint({ x: 570, y: 1170 }, container, display, scale)).toEqual({
      x: 1080,
      y: 2340,
    });
  });

  it("rejects points in the letterbox around the frame", () => {
    expect(toDevicePoint({ x: 29, y: 100 }, container, display, scale)).toBeNull();
    expect(toDevicePoint({ x: 571, y: 100 }, container, display, scale)).toBeNull();
    expect(toDevicePoint({ x: 100, y: 1171 }, container, display, scale)).toBeNull();
  });

  it("rejects everything before the frame has a size", () => {
    expect(toDevicePoint({ x: 0, y: 0 }, container, { width: 0, height: 0 }, 0)).toBeNull();
  });
});

describe("wheelSwipeEndY", () => {
  it("drags the finger up by the scroll distance in device pixels when scrolling down", () => {
    expect(wheelSwipeEndY(1000, 100, 0.5, 2340)).toBe(800);
  });

  it("drags down when scrolling up", () => {
    expect(wheelSwipeEndY(1000, -50, 0.5, 2340)).toBe(1100);
  });

  it("stays on screen", () => {
    expect(wheelSwipeEndY(100, 1000, 0.5, 2340)).toBe(0);
    expect(wheelSwipeEndY(2300, -1000, 0.5, 2340)).toBe(2339);
  });
});

describe("toolbarSwipe", () => {
  it("scrolls down by dragging the finger up the middle of the screen", () => {
    expect(toolbarSwipe("down", 1080, 2340)).toEqual({
      x1: 540,
      y1: 1638,
      x2: 540,
      y2: 702,
      duration_ms: 300,
    });
  });

  it("scrolls up by dragging the finger down", () => {
    expect(toolbarSwipe("up", 1080, 2340)).toEqual({
      x1: 540,
      y1: 702,
      x2: 540,
      y2: 1638,
      duration_ms: 300,
    });
  });

  it("flips to the page on the left with a long, fast sweep to the right", () => {
    expect(toolbarSwipe("left", 1080, 2340)).toEqual({
      x1: 108,
      y1: 1170,
      x2: 972,
      y2: 1170,
      duration_ms: 150,
    });
  });

  it("flips to the page on the right with a long, fast sweep to the left", () => {
    expect(toolbarSwipe("right", 1080, 2340)).toEqual({
      x1: 972,
      y1: 1170,
      x2: 108,
      y2: 1170,
      duration_ms: 150,
    });
  });

  it("horizontal sweeps cover most of the width, faster than vertical drags", () => {
    const h = toolbarSwipe("right", 402, 874);
    const v = toolbarSwipe("down", 402, 874);
    expect(Math.abs(h.x2 - h.x1)).toBeGreaterThanOrEqual(402 * 0.75);
    expect(h.duration_ms).toBeLessThan(v.duration_ms);
  });

  it("stays on screen and returns whole stream pixels for odd sizes", () => {
    for (const dir of ["up", "down", "left", "right"] as const) {
      const s = toolbarSwipe(dir, 403, 875);
      for (const [v, max] of [
        [s.x1, 403],
        [s.x2, 403],
        [s.y1, 875],
        [s.y2, 875],
      ]) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(max);
      }
    }
  });
});
