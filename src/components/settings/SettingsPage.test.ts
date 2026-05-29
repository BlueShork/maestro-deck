// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";

import { resolveSection, SETTINGS_SECTIONS } from "./sections";

describe("resolveSection", () => {
  it("resolves each known section by id", () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(resolveSection(s.id).id).toBe(s.id);
    }
  });

  it("falls back to the first section for unknown ids", () => {
    expect(resolveSection("does-not-exist").id).toBe(SETTINGS_SECTIONS[0].id);
  });

  it("falls back to the first section when the segment is missing", () => {
    expect(resolveSection(undefined).id).toBe(SETTINGS_SECTIONS[0].id);
  });

  it("exposes the expected sections in sidebar order", () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toEqual([
      "general",
      "device",
      "tools",
      "ai",
      "about",
    ]);
  });
});
