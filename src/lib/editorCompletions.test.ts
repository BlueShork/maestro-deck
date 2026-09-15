// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { maestroCompletions } from "./editorCompletions";
import type { CompletionContext } from "@codemirror/autocomplete";

// Minimal stand-in for CompletionContext: maestroCompletions only uses
// matchBefore and explicit.
function ctx(word: { from: number; to: number; text: string } | null, explicit = false) {
  return {
    explicit,
    matchBefore: () => word,
  } as unknown as CompletionContext;
}

describe("maestroCompletions", () => {
  it("returns null when there is no word and the query is implicit", () => {
    expect(maestroCompletions(ctx({ from: 3, to: 3, text: "" }))).toBeNull();
    expect(maestroCompletions(ctx(null))).toBeNull();
  });

  it("returns options when typing a word", () => {
    const result = maestroCompletions(ctx({ from: 0, to: 3, text: "tap" }));
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
  });

  it("reuses the same options array across calls (no per-keystroke rebuild)", () => {
    const a = maestroCompletions(ctx({ from: 0, to: 3, text: "tap" }));
    const b = maestroCompletions(ctx({ from: 0, to: 4, text: "tapO" }));
    expect(a!.options).toBe(b!.options);
  });

  it("declares validFor so CodeMirror filters incrementally instead of re-querying", () => {
    const result = maestroCompletions(ctx({ from: 0, to: 3, text: "tap" }));
    expect(result!.validFor).toBeInstanceOf(RegExp);
    // Continuing to type word characters must stay within the same result.
    const re = result!.validFor as RegExp;
    expect(re.test("tapOn")).toBe(true);
    expect(re.test("assert-visible")).toBe(true);
  });
});
