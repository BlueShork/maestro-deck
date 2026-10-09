// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import type { StepRunState } from "@/stores/runStore";

import { buildRunReport } from "./build";
import type { ReportContext } from "./types";

const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({
  id: "r1",
  kind: "flow",
  title: "login",
  startedAt: 1000,
  endedAt: 13_000,
  exitCode: 0,
  stopRequested: false,
  project: { name: "shop", branch: "main" },
  device: { platform: "android", name: "Pixel 8" },
  ...over,
});

const step = (over: Partial<StepRunState>): StepRunState => ({
  index: 0,
  line: 1,
  endLine: 1,
  command: "tapOn",
  arg: "Login",
  status: "done",
  startedAt: 0,
  durationMs: 400,
  error: null,
  ...over,
});

describe("buildRunReport", () => {
  it("turns a single run's steps into items", () => {
    const r = buildRunReport(
      ctx({ exitCode: 1 }),
      [
        step({ command: "launchApp", arg: null }),
        step({ index: 1, status: "failed", error: "Element not found" }),
        step({ index: 2, status: "pending", durationMs: null }),
      ],
      [],
    );
    expect(r.items).toEqual([
      { name: "launchApp", status: "passed", durationMs: 400, error: null },
      { name: 'tapOn "Login"', status: "failed", durationMs: 400, error: "Element not found" },
      { name: 'tapOn "Login"', status: "skipped", durationMs: null, error: null },
    ]);
    expect(r.status).toBe("failed");
    expect(r.totals).toEqual({ passed: 1, failed: 1, skipped: 1 });
    expect(r.durationMs).toBe(12_000);
  });

  it("uses suite flows for Run All and ignores steps", () => {
    const r = buildRunReport(
      ctx({ kind: "all", title: "flows" }),
      [step({ status: "failed" })],
      [{ name: "login", status: "passed", durationMs: 5000, error: null }],
    );
    expect(r.items).toHaveLength(1);
    expect(r.status).toBe("passed");
  });

  it("is failed when the runner exits non-zero even if every item passed", () => {
    expect(buildRunReport(ctx({ exitCode: 1 }), [step({})], []).status).toBe("failed");
  });

  it("is stopped when the runner gave no exit code and nothing failed (outcome unknown)", () => {
    // A cloud run the app stopped watching, or whose result was unreadable.
    expect(buildRunReport(ctx({ exitCode: null }), [step({ status: "pending" })], []).status).toBe(
      "stopped",
    );
    expect(buildRunReport(ctx({ exitCode: null }), [step({ status: "failed" })], []).status).toBe(
      "failed",
    );
  });

  it("is stopped when the user stopped it, with no items if nothing finished", () => {
    const r = buildRunReport(ctx({ kind: "all", stopRequested: true, exitCode: 143 }), [], []);
    expect(r.status).toBe("stopped");
    expect(r.items).toEqual([]);
    expect(r.totals).toEqual({ passed: 0, failed: 0, skipped: 0 });
  });

  it("falls back on Maestro's flow result when no step could be followed (farm runs)", () => {
    // The farm agent runs `maestro test --format JUNIT`: suite output, no step lines.
    const r = buildRunReport(
      ctx({ exitCode: 0 }),
      [step({ status: "running", durationMs: null }), step({ index: 1, status: "pending" })],
      [{ name: "open_playstore", status: "passed", durationMs: 6000, error: null }],
    );
    expect(r.items).toEqual([
      { name: "open_playstore", status: "passed", durationMs: 6000, error: null },
    ]);
    expect(r.totals).toEqual({ passed: 1, failed: 0, skipped: 0 });
    expect(r.status).toBe("passed");
  });

  it("keeps the steps when at least one was followed", () => {
    const r = buildRunReport(
      ctx(),
      [step({}), step({ index: 1, status: "pending" })],
      [{ name: "login", status: "passed", durationMs: 6000, error: null }],
    );
    expect(r.items).toHaveLength(2);
  });
});
