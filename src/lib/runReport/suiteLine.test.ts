// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { parseDuration, parseSuiteLine } from "./suiteLine";

describe("parseDuration", () => {
  it("reads kotlin Duration strings", () => {
    expect(parseDuration("850ms")).toBe(850);
    expect(parseDuration("12s")).toBe(12_000);
    expect(parseDuration("1m 5.2s")).toBe(65_200);
    expect(parseDuration("1h 2m 3s")).toBe(3_723_000);
    expect(parseDuration("soon")).toBeNull();
  });
});

describe("parseSuiteLine", () => {
  it("parses a passed flow", () => {
    expect(parseSuiteLine("[Passed] login (5s)")).toEqual({
      name: "login",
      status: "passed",
      durationMs: 5000,
      error: null,
    });
  });

  it("keeps the whole error, parentheses included", () => {
    expect(
      parseSuiteLine(
        "[Failed] checkout flow (1m 2s) (Element not found: Text matching regex: (Login))",
      ),
    ).toEqual({
      name: "checkout flow",
      status: "failed",
      durationMs: 62_000,
      error: "Element not found: Text matching regex: (Login)",
    });
  });

  it("keeps a failure whose error continues on the next line", () => {
    expect(parseSuiteLine("[Failed] boot (3s) (Unable to launch app com.shop:")).toEqual({
      name: "boot",
      status: "failed",
      durationMs: 3000,
      error: "Unable to launch app com.shop:",
    });
  });

  it("strips ANSI colours, shard prefix and the warning suffix", () => {
    const raw =
      "\u001b[36m[shard 2] \u001b[39m[Passed] settings (850ms)\u001b[33m (Warning)\u001b[39m";
    expect(parseSuiteLine(raw)).toEqual({
      name: "settings",
      status: "passed",
      durationMs: 850,
      error: null,
    });
  });

  it("maps other terminal statuses", () => {
    expect(parseSuiteLine("[Skipped] a (0s)")?.status).toBe("skipped");
    expect(parseSuiteLine("[Canceled by user] a (0s)")?.status).toBe("skipped");
    expect(parseSuiteLine("[Timeout] a (30s)")?.status).toBe("failed");
    expect(parseSuiteLine("[Stopped] a (3s)")?.status).toBe("failed");
  });

  it("ignores non-terminal statuses and other output", () => {
    expect(parseSuiteLine("[Running] a (1s)")).toBeNull();
    expect(parseSuiteLine(" > Flow login")).toBeNull();
    expect(parseSuiteLine('Tap on "Login"... COMPLETED')).toBeNull();
    expect(parseSuiteLine("2/3 Flows Failed")).toBeNull();
    expect(parseSuiteLine("")).toBeNull();
  });
});
