import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b", "c")).toBe("a b c");
  });

  it("filters falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("flattens arrays and objects (clsx semantics)", () => {
    expect(cn(["a", "b"], { c: true, d: false })).toBe("a b c");
  });

  it("merges conflicting tailwind utilities — last wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("preserves non-conflicting tailwind utilities", () => {
    expect(cn("p-2", "m-4")).toBe("p-2 m-4");
  });

  it("returns empty string for no input", () => {
    expect(cn()).toBe("");
  });
});
