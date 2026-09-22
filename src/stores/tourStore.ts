// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { TOUR_STEPS } from "@/lib/tourSteps";
import { useOnboardingStore } from "@/stores/onboardingStore";

interface TourState {
  /** Persisted: has the user completed or skipped the tour at least once. */
  hasSeenTour: boolean;
  /** Ephemeral: is the overlay currently showing. */
  isActive: boolean;
  /** Ephemeral: index into TOUR_STEPS. */
  stepIndex: number;
  start: () => void;
  next: () => void;
  prev: () => void;
  skip: () => void;
  finish: () => void;
}

export const useTourStore = create<TourState>()(
  persist(
    (set, get) => ({
      hasSeenTour: false,
      isActive: false,
      stepIndex: 0,
      start: () => set({ isActive: true, stepIndex: 0 }),
      next: () => {
        const { stepIndex } = get();
        if (stepIndex >= TOUR_STEPS.length - 1) {
          set({ isActive: false, hasSeenTour: true });
          // Reaching the end is the signal to offer the hands-on half. Skipping
          // is not: someone who cut the tour short is not asking for more.
          if (!useOnboardingStore.getState().done) useOnboardingStore.getState().start();
          return;
        }
        set({ stepIndex: stepIndex + 1 });
      },
      prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
      skip: () => set({ isActive: false, hasSeenTour: true }),
      finish: () => {
        set({ isActive: false, hasSeenTour: true });
        if (!useOnboardingStore.getState().done) useOnboardingStore.getState().start();
      },
    }),
    {
      name: "maestro-deck.tour",
      storage: createJSONStorage(() => localStorage),
      // Only the "seen" flag survives reloads; active step state is in-memory.
      partialize: (s) => ({ hasSeenTour: s.hasSeenTour }),
    },
  ),
);
