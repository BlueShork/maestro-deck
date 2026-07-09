// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { useTourStore } from "./tourStore";
import { TOUR_STEPS } from "@/lib/tourSteps";

beforeEach(() => {
  useTourStore.setState({ hasSeenTour: false, isActive: false, stepIndex: 0 });
});

describe("tourStore", () => {
  it("start activates at step 0", () => {
    useTourStore.getState().start();
    const s = useTourStore.getState();
    expect(s.isActive).toBe(true);
    expect(s.stepIndex).toBe(0);
  });

  it("next advances the step index", () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    expect(useTourStore.getState().stepIndex).toBe(1);
  });

  it("next on the last step finishes the tour", () => {
    useTourStore.getState().start();
    useTourStore.setState({ stepIndex: TOUR_STEPS.length - 1 });
    useTourStore.getState().next();
    const s = useTourStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.hasSeenTour).toBe(true);
  });

  it("prev clamps at 0", () => {
    useTourStore.getState().start();
    useTourStore.getState().prev();
    expect(useTourStore.getState().stepIndex).toBe(0);
  });

  it("skip closes the tour and marks it seen", () => {
    useTourStore.getState().start();
    useTourStore.getState().skip();
    const s = useTourStore.getState();
    expect(s.isActive).toBe(false);
    expect(s.hasSeenTour).toBe(true);
  });

  it("persists only hasSeenTour", () => {
    useTourStore.getState().start();
    useTourStore.getState().next();
    const raw = localStorage.getItem("maestro-deck.tour");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string);
    expect(parsed.state).toEqual({ hasSeenTour: false });
    expect(parsed.state.isActive).toBeUndefined();
    expect(parsed.state.stepIndex).toBeUndefined();
  });
});
