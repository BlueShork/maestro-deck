// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect } from "vitest";

import { metricsForDevice, thermalLabel } from "./metricsCards";

describe("metricsForDevice", () => {
  it("android shows the full card set", () => {
    const r = metricsForDevice("android", false);
    expect(r.kind).toBe("cards");
    if (r.kind === "cards") {
      expect(r.cards).toEqual(["cpu", "ram", "fps", "jank", "frameTimes", "thermal"]);
    }
  });

  it("ios simulator shows cpu/ram with a note", () => {
    const r = metricsForDevice("ios", false);
    expect(r.kind).toBe("cards");
    if (r.kind === "cards") {
      expect(r.cards).toEqual(["cpu", "ram"]);
      expect(r.note).toBeTruthy();
    }
  });

  it("ios physical is limited", () => {
    expect(metricsForDevice("ios", true).kind).toBe("limited");
  });

  it("web is limited", () => {
    expect(metricsForDevice("web", false).kind).toBe("limited");
  });
});

describe("thermalLabel", () => {
  it("maps known codes", () => {
    expect(thermalLabel(0)).toBe("None");
    expect(thermalLabel(3)).toBe("Severe");
  });
  it("handles null/unknown", () => {
    expect(thermalLabel(null)).toBe("—");
    expect(thermalLabel(42)).toBe("Unknown");
  });
});
