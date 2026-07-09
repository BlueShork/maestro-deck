// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  } as Storage;
});

import { TourOverlay } from "./TourOverlay";
import { useTourStore } from "@/stores/tourStore";

beforeEach(() => {
  useTourStore.setState({ hasSeenTour: false, isActive: false, stepIndex: 0 });
});

const render = () => renderToStaticMarkup(<TourOverlay />);

describe("TourOverlay", () => {
  it("renders nothing when the tour is inactive", () => {
    expect(render()).toBe("");
  });

  it("renders the first step's title and body when active", () => {
    useTourStore.setState({ isActive: true, stepIndex: 0 });
    const html = render();
    expect(html).toMatch(/Connect your phone/);
    expect(html).toMatch(/Plug in your Android phone/);
  });

  it("interpolates the inspect key into the mirror step", () => {
    useTourStore.setState({ isActive: true, stepIndex: 1 });
    const html = render();
    // default inspectKey is "i"; token must be replaced, not left literal
    expect(html).not.toMatch(/\{inspectKey\}/);
    expect(html).toMatch(/press .?i.?/i);
  });

  it("labels the last step's advance button Finish", () => {
    useTourStore.setState({ isActive: true, stepIndex: 4 });
    const html = render();
    expect(html).toMatch(/Finish/);
  });

  it("always offers a Skip control", () => {
    useTourStore.setState({ isActive: true, stepIndex: 0 });
    expect(render()).toMatch(/Skip/i);
  });
});
