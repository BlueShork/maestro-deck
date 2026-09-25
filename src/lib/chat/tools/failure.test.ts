// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";
import { extractFailure } from "./failure";

describe("extractFailure", () => {
  it("finds a FAILED step and adopts the deferred detail line", () => {
    const tail = [
      " > Flow login",
      'Launch app "com.x"... COMPLETED',
      'Assert that "Welcome" is visible... FAILED',
      'Assertion is false: "Welcome" is visible',
    ];
    expect(extractFailure(tail)).toEqual({
      command: "assertVisible",
      arg: "Welcome",
      error: 'Assertion is false: "Welcome" is visible',
      line: null,
    });
  });

  it("returns the failed event even without a detail line", () => {
    const tail = ['Tap on "Email"... FAILED'];
    const f = extractFailure(tail);
    expect(f?.command).toBe("tapOn");
    expect(f?.arg).toBe("Email");
    expect(f?.error).toBeNull();
  });

  it("ignores completed steps, flow headers and blank lines", () => {
    expect(extractFailure([" > Flow a", 'Tap on "X"... COMPLETED', ""])).toBeNull();
  });

  it("skips indented subflow context but keeps the first failure at any depth", () => {
    const tail = ["Run flow...", '  Tap on "X"... FAILED', "Element not found"];
    const f = extractFailure(tail);
    expect(f?.command).toBe("tapOn");
    expect(f?.error).toBe("Element not found");
  });
});
