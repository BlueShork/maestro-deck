// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, describe, expect, it } from "vitest";

import type { PluginTheme } from "@/lib/plugins/types";

import { applyColorTheme, effectiveMode, forcedMode } from "./colorTheme";

const root = () => document.documentElement.style;

afterEach(() => applyColorTheme(null, "light"));

describe("colorTheme", () => {
  it("forces the only variant a theme has", () => {
    expect(forcedMode(null)).toBeNull();
    expect(forcedMode({ dark: { brand: "1 1% 1%" } })).toBe("dark");
    expect(forcedMode({ light: { brand: "1 1% 1%" } })).toBe("light");
    expect(forcedMode({ light: { brand: "1 1% 1%" }, dark: { brand: "1 1% 1%" } })).toBeNull();
    expect(effectiveMode({ dark: { brand: "1 1% 1%" } }, "light")).toBe("dark");
    expect(effectiveMode(null, "light")).toBe("light");
  });

  it("sets the active variant and radius", () => {
    applyColorTheme(
      { light: { brand: "266 85% 58%" }, dark: { brand: "267 84% 81%" }, radius: "0.5rem" },
      "dark",
    );
    expect(root().getPropertyValue("--brand")).toBe("267 84% 81%");
    expect(root().getPropertyValue("--radius")).toBe("0.5rem");
  });

  it("removes everything the previous theme set", () => {
    applyColorTheme({ light: { brand: "1 1% 1%", border: "2 2% 2%" }, radius: "1rem" }, "light");
    applyColorTheme({ light: { muted: "3 3% 3%" } }, "light");
    expect(root().getPropertyValue("--brand")).toBe("");
    expect(root().getPropertyValue("--border")).toBe("");
    expect(root().getPropertyValue("--radius")).toBe("");
    expect(root().getPropertyValue("--muted")).toBe("3 3% 3%");
    applyColorTheme(null, "light");
    expect(root().getPropertyValue("--muted")).toBe("");
  });

  it("ignores unknown tokens and malformed values (tampered cache)", () => {
    applyColorTheme(
      {
        light: {
          brand: "red; background: url(https://x)",
          "--evil": "1 1% 1%",
          muted: "3 3% 3%",
        },
        radius: "9rem",
      } as PluginTheme,
      "light",
    );
    expect(root().getPropertyValue("--brand")).toBe("");
    expect(root().getPropertyValue("--evil")).toBe("");
    expect(root().getPropertyValue("--radius")).toBe("");
    expect(root().getPropertyValue("--muted")).toBe("3 3% 3%");
  });

  it.each(["361 50% 50%", "1 101% 1%", "1e2 50% 50%", "NaN 1% 1%"])(
    "does not apply the out-of-range or non-numeric value %s",
    (value) => {
      applyColorTheme({ light: { brand: value } }, "light");
      expect(root().getPropertyValue("--brand")).toBe("");
    },
  );
});
