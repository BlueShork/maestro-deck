// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, describe, expect, it } from "vitest";

import { applyTheme } from "./theme";

afterEach(() => applyTheme("light", null));

describe("applyTheme", () => {
  it("forces the dark class for a dark-only theme, and undoes it", () => {
    applyTheme("light", { dark: { brand: "267 84% 81%" } });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.getPropertyValue("--brand")).toBe("267 84% 81%");
    applyTheme("light", null);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--brand")).toBe("");
  });
});
