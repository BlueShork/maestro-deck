import { describe, it, expect } from "vitest";
import { BILLY_SYSTEM_PROMPT } from "./systemPrompt";

describe("BILLY_SYSTEM_PROMPT", () => {
  it("is a non-empty string", () => {
    expect(typeof BILLY_SYSTEM_PROMPT).toBe("string");
    expect(BILLY_SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });
});
