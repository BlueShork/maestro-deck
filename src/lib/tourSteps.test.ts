// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";

import { TOUR_STEPS } from "./tourSteps";

const VALID_PANELS = ["workspace", "inspector", "device", "editor", "console", "metrics"];

describe("tourSteps", () => {
  it("has the five onboarding steps in order", () => {
    expect(TOUR_STEPS.map((s) => s.id)).toEqual(["device", "mirror", "editor", "run", "chat"]);
  });

  it("has unique step ids", () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only references valid panel ids", () => {
    for (const step of TOUR_STEPS) {
      for (const p of step.requiresPanel) {
        expect(VALID_PANELS).toContain(p);
      }
    }
  });

  it("gives every step a target, title, and body", () => {
    for (const step of TOUR_STEPS) {
      expect(step.target).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.body).toBeTruthy();
    }
  });

  it("marks the chat step as informational with no required panels", () => {
    const chat = TOUR_STEPS.find((s) => s.id === "chat");
    expect(chat?.informational).toBe(true);
    expect(chat?.requiresPanel).toEqual([]);
  });
});
