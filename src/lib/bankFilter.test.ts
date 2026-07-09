// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { filterGroups, filterImages, matchesQuery } from "@/lib/bankFilter";
import type { BankGroup, BankImage } from "@/types/visualRegression";

const img = (name: string): BankImage => ({
  name,
  width: 100,
  height: 200,
  size_bytes: 1000,
  modified_ms: 0,
});

const GROUPS: BankGroup[] = [
  { device_key: "iPhone_16_Pro_1179x2556", images: [img("login"), img("home")] },
  { device_key: "Pixel_8_1080x2400", images: [img("checkout_summary")] },
];

describe("matchesQuery", () => {
  it("is case-insensitive substring", () => {
    expect(matchesQuery("Checkout_Summary", "SUMM")).toBe(true);
    expect(matchesQuery("home", "xyz")).toBe(false);
  });
  it("empty query matches everything", () => {
    expect(matchesQuery("anything", "")).toBe(true);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("filterImages", () => {
  it("filters by image name", () => {
    expect(filterImages(GROUPS[0].images, "log").map((i) => i.name)).toEqual(["login"]);
  });
  it("returns all on empty query", () => {
    expect(filterImages(GROUPS[0].images, "")).toHaveLength(2);
  });
});

describe("filterGroups", () => {
  it("keeps a group when its device_key matches", () => {
    expect(filterGroups(GROUPS, "pixel").map((g) => g.device_key)).toEqual(["Pixel_8_1080x2400"]);
  });
  it("keeps a group when one of its images matches", () => {
    expect(filterGroups(GROUPS, "login").map((g) => g.device_key)).toEqual([
      "iPhone_16_Pro_1179x2556",
    ]);
  });
  it("matches the humanized device name (underscores as spaces)", () => {
    expect(filterGroups(GROUPS, "iphone 16").map((g) => g.device_key)).toEqual([
      "iPhone_16_Pro_1179x2556",
    ]);
  });
  it("returns all groups on empty query", () => {
    expect(filterGroups(GROUPS, "")).toHaveLength(2);
  });
});
