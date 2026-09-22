// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/** Package declared in sample-app/AndroidManifest.xml. */
export const SAMPLE_APP_ID = "com.maestrodeck.sample";

/**
 * The flow the onboarding writes for the user.
 *
 * Every command here was run against the real sample app on a physical device
 * before being written down (see the design doc). It asserts the screen before
 * touching it, because a first flow teaches habits: tapping blind is how flaky
 * tests start.
 */
export const ONBOARDING_FLOW = `# Your first Maestro flow.
# Each line is one step. Run it and watch them light up below.
appId: ${SAMPLE_APP_ID}
---
# Start the app from scratch.
- launchApp

# Check we are on the right screen before touching anything.
- assertVisible: "Sign in"

# Type into the email field, found by its id.
- tapOn:
    id: "email"
- inputText: "you@example.com"

# Submit, then prove it worked.
- tapOn:
    id: "signin"
- assertVisible: "Welcome back!"
`;

/**
 * What the last step should say, from the run's own state.
 *
 * A first run that fails is the moment a new user decides whether this tool
 * works. Saying "waiting for you to press Run" while their run sits failed
 * behind the dialog is the worst answer available, so failure gets named and
 * pointed at the console.
 */
export function onboardingRunState(
  running: boolean,
  exitCode: number | null,
): "waiting" | "running" | "passed" | "failed" {
  if (running) return "running";
  if (exitCode === null) return "waiting";
  return exitCode === 0 ? "passed" : "failed";
}

/** Where the user chose to run their first test. */
export type OnboardingTarget = "device" | "cloud";

export type OnboardingStep = "choose-target" | "sign-in" | "install" | "write" | "run";

interface OnboardingState {
  active: boolean;
  step: OnboardingStep;
  target: OnboardingTarget | null;
  /** Persisted: completed or quit at least once, so it never reappears on its
   *  own. Help can still reopen it. */
  done: boolean;

  start: () => void;
  /** `signedIn` decides whether the cloud path needs the account dialog. */
  chooseTarget: (target: OnboardingTarget, opts?: { signedIn: boolean }) => void;
  /** The account became live while the sign-in step was showing. */
  signedIn: () => void;
  next: () => void;
  quit: () => void;
}

const ORDER: OnboardingStep[] = ["choose-target", "sign-in", "install", "write", "run"];

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      active: false,
      step: "choose-target",
      target: null,
      done: false,

      start: () => set({ active: true, step: "choose-target", target: null }),

      chooseTarget: (target, opts) =>
        set({
          target,
          // Only the cloud needs an account, and only when there isn't one.
          step: target === "cloud" && !opts?.signedIn ? "sign-in" : "install",
        }),

      signedIn: () => {
        // Guarded: the user can sign in from the account page at any moment,
        // and that must not jump the onboarding forward a step.
        if (get().step !== "sign-in") return;
        set({ step: "install" });
      },

      next: () => {
        const i = ORDER.indexOf(get().step);
        const following = ORDER[i + 1];
        if (!following) {
          set({ active: false, done: true });
          return;
        }
        // Never land back on sign-in by walking forward: it is only reachable
        // from the cloud choice.
        set({ step: following === "sign-in" ? "install" : following });
      },

      quit: () => set({ active: false, done: true }),
    }),
    {
      name: "maestro-deck.onboarding",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ done: s.done }),
    },
  ),
);
