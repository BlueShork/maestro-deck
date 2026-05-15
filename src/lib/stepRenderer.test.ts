// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";
import { humanLabel, formatDuration } from "./stepRenderer";

describe("humanLabel", () => {
  it("formats launchApp", () => {
    expect(humanLabel({ command: "launchApp", arg: "com.example" })).toBe("Open com.example app");
  });

  it("formats tapOn", () => {
    expect(humanLabel({ command: "tapOn", arg: "Login" })).toBe(`Tap "Login"`);
  });

  it("formats assertVisible", () => {
    expect(humanLabel({ command: "assertVisible", arg: "Welcome" })).toBe(
      `Check that "Welcome" is visible`,
    );
  });

  it("formats inputText", () => {
    expect(humanLabel({ command: "inputText", arg: "hello" })).toBe(`Type "hello"`);
  });

  it("formats arg-less commands", () => {
    expect(humanLabel({ command: "back", arg: null })).toBe("Press back");
    expect(humanLabel({ command: "hideKeyboard", arg: null })).toBe("Hide keyboard");
  });

  it("falls back to raw command for unknown command + arg", () => {
    expect(humanLabel({ command: "weirdThing", arg: "x" })).toBe(`weirdThing "x"`);
    expect(humanLabel({ command: "weirdThing", arg: null })).toBe("weirdThing");
  });
});

describe("formatDuration", () => {
  it("under 100ms shows <0.1s", () => {
    expect(formatDuration(50)).toBe("<0.1s");
  });

  it("formats sub-second", () => {
    expect(formatDuration(345)).toBe("0.3s");
  });

  it("formats seconds with one decimal", () => {
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(12_400)).toBe("12.4s");
  });

  it("returns empty string for null", () => {
    expect(formatDuration(null)).toBe("");
  });
});
