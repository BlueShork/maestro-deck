// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const storage = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
});

import {
  ONBOARDING_FLOW,
  onboardingRunState,
  shouldAutoStartWalkthrough,
  useOnboardingStore,
} from "./onboardingStore";

beforeEach(() => {
  useOnboardingStore.setState({
    active: false,
    step: "choose-target",
    target: null,
    done: false,
  });
});

describe("onboardingStore", () => {
  it("opens on the choice of where to run", () => {
    useOnboardingStore.getState().start();
    const s = useOnboardingStore.getState();
    expect(s.active).toBe(true);
    expect(s.step).toBe("choose-target");
  });

  it("goes straight to installing when the device is chosen", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("device");

    const s = useOnboardingStore.getState();
    expect(s.target).toBe("device");
    expect(s.step).toBe("install");
  });

  it("stops at sign-in when the cloud is chosen without an account", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("cloud", { signedIn: false });
    expect(useOnboardingStore.getState().step).toBe("sign-in");
  });

  it("skips sign-in when the account is already there", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("cloud", { signedIn: true });
    expect(useOnboardingStore.getState().step).toBe("install");
  });

  it("resumes where it left off once the account is live", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("cloud", { signedIn: false });

    useOnboardingStore.getState().signedIn();

    // The point of the dialog: the user never loses their place.
    const s = useOnboardingStore.getState();
    expect(s.step).toBe("install");
    expect(s.target).toBe("cloud");
  });

  it("ignores a sign-in that arrives outside the sign-in step", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("device");
    useOnboardingStore.getState().signedIn();
    // Signing in from the account page mid-onboarding must not skip a step.
    expect(useOnboardingStore.getState().step).toBe("install");
  });

  it("walks install → write → run", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("device");
    useOnboardingStore.getState().next();
    expect(useOnboardingStore.getState().step).toBe("write");
    useOnboardingStore.getState().next();
    expect(useOnboardingStore.getState().step).toBe("run");
  });

  it("closes and remembers when quit at any step", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().chooseTarget("device");
    useOnboardingStore.getState().quit();

    const s = useOnboardingStore.getState();
    expect(s.active).toBe(false);
    // Remembered, so it never reappears uninvited — Help can still reopen it.
    expect(s.done).toBe(true);
  });

  it("can be reopened after being quit", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().quit();
    useOnboardingStore.getState().start();

    const s = useOnboardingStore.getState();
    expect(s.active).toBe(true);
    expect(s.step).toBe("choose-target");
  });
});

describe("the generated flow", () => {
  it("targets the bundled sample app", () => {
    expect(ONBOARDING_FLOW).toContain("appId: com.maestrodeck.sample");
  });

  it("teaches the four commands a first flow needs", () => {
    // Verified against the real app on a device; see the design doc.
    for (const command of ["launchApp", "assertVisible", "tapOn", "inputText"]) {
      expect(ONBOARDING_FLOW).toContain(command);
    }
  });

  it("asserts the screen before touching it", () => {
    // A flow that taps before asserting teaches a habit that produces flaky
    // tests, which is the opposite of the lesson.
    expect(ONBOARDING_FLOW.indexOf("assertVisible")).toBeLessThan(ONBOARDING_FLOW.indexOf("tapOn"));
  });
});

describe("onboardingRunState", () => {
  it("waits before the first run", () => {
    expect(onboardingRunState(false, null)).toBe("waiting");
  });

  it("follows a run in flight", () => {
    expect(onboardingRunState(true, null)).toBe("running");
  });

  it("celebrates a pass", () => {
    expect(onboardingRunState(false, 0)).toBe("passed");
  });

  it("names a failure instead of asking again for a run that already happened", () => {
    // The old behaviour showed "waiting for you to press Run" over a failed
    // run — the worst possible answer at the moment a new user is deciding.
    expect(onboardingRunState(false, 1)).toBe("failed");
  });
});

describe("shouldAutoStartWalkthrough", () => {
  const base = { hasSeenTour: true, walkthroughDone: false, toolsReady: true };

  it("opens for someone who saw the tour before the walkthrough existed", () => {
    // Without this they would never meet it: the tour only hands over at its
    // end, and theirs ended long ago.
    expect(shouldAutoStartWalkthrough(base)).toBe(true);
  });

  it("leaves a first-time user to the tour, which hands over itself", () => {
    expect(shouldAutoStartWalkthrough({ ...base, hasSeenTour: false })).toBe(false);
  });

  it("never reopens what was already seen", () => {
    // Shown once, never nagged.
    expect(shouldAutoStartWalkthrough({ ...base, walkthroughDone: true })).toBe(false);
  });

  it("waits until the tools are there", () => {
    // It ends on "press Run"; opening it while Run is disabled would say the
    // app is broken.
    expect(shouldAutoStartWalkthrough({ ...base, toolsReady: false })).toBe(false);
  });
});
