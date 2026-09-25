// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, describe, it, expect } from "vitest";
import { BILLY_SYSTEM_PROMPT, BILLY_TOOLS_PROMPT, getEffectiveBillyPrompt } from "./systemPrompt";
import { useBillyPromptStore } from "@/stores/billyPromptStore";

describe("BILLY_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof BILLY_SYSTEM_PROMPT).toBe("string");
    expect(BILLY_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it("does not embed the tools manual (it lives in its own file)", () => {
    expect(BILLY_SYSTEM_PROMPT).not.toContain("## Your tools (agent mode)");
    expect(BILLY_TOOLS_PROMPT).toContain("## Your tools (agent mode)");
  });
});

describe("getEffectiveBillyPrompt", () => {
  const original = useBillyPromptStore.getState().customPrompt;
  afterEach(() => useBillyPromptStore.setState({ customPrompt: original }));

  it("appends the tools manual to the default prompt", () => {
    useBillyPromptStore.setState({ customPrompt: null });
    const p = getEffectiveBillyPrompt();
    expect(p).toContain("## Your role");
    expect(p).toContain("## Your tools (agent mode)");
  });

  it("appends the tools manual to a custom prompt too", () => {
    useBillyPromptStore.setState({ customPrompt: "You are a pirate." });
    const p = getEffectiveBillyPrompt();
    expect(p.startsWith("You are a pirate.")).toBe(true);
    expect(p).toContain("## Your tools (agent mode)");
  });
});
