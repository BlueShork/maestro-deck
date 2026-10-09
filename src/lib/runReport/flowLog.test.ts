// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { createFlowLog } from "./flowLog";

const feed = (lines: string[], step = 1000) => {
  const log = createFlowLog();
  lines.forEach((l, i) => log.feed(l, i * step));
  return log;
};

describe("createFlowLog", () => {
  it("reads a real Maestro 2.10 Run All transcript (no suite lines)", () => {
    const log = feed([
      "Running on R3CX30GR07Y",
      " > Flow open_playstore",
      'Launch app "com.android.vending"... COMPLETED',
      "Wait for animation to end... COMPLETED",
      "Take screenshot test... COMPLETED",
      "Wait for animation to end... COMPLETED",
    ]);
    expect(log.finish({ at: 9000, exitCode: 0, stopped: false })).toEqual([
      { name: "open_playstore", status: "passed", durationMs: 8000, error: null },
    ]);
  });

  it("marks the flow with a FAILED step and keeps the detail line as its error", () => {
    const log = feed([
      " > Flow login",
      'Tap on "Go"... COMPLETED',
      " > Flow checkout",
      'Tap on "Pay"... FAILED',
      "",
      "Element not found: Text matching regex: Pay",
      " > Flow settings",
      "Back... COMPLETED",
    ]);
    expect(log.finish({ at: 10_000, exitCode: 1, stopped: false })).toEqual([
      { name: "login", status: "passed", durationMs: 2000, error: null },
      {
        name: "checkout",
        status: "failed",
        durationMs: 4000,
        error: "Element not found: Text matching regex: Pay",
      },
      { name: "settings", status: "passed", durationMs: 4000, error: null },
    ]);
  });

  it("names the failing step when no detail line follows", () => {
    const log = feed([" > Flow a", 'Tap on "X"... FAILED']);
    expect(log.finish({ at: 5000, exitCode: 1, stopped: false })[0].error).toBe(
      'Tap on "X" failed',
    );
  });

  it("blames the last flow when the run failed without a FAILED line", () => {
    const log = feed([" > Flow a", "Back... COMPLETED", " > Flow b"]);
    expect(log.finish({ at: 5000, exitCode: 1, stopped: false }).map((f) => f.status)).toEqual([
      "passed",
      "failed",
    ]);
  });

  it("leaves out the flow that was running when the user stopped", () => {
    const log = feed([" > Flow a", "Back... COMPLETED", " > Flow b"]);
    expect(log.finish({ at: 5000, exitCode: 143, stopped: true }).map((f) => f.name)).toEqual([
      "a",
    ]);
  });

  it("counts hook headers and subflow steps as part of the flow", () => {
    const log = feed([
      " > Flow a",
      "  > On Flow Start",
      "Run flow... ",
      '  Tap on "Inner"... FAILED',
      "Run flow... FAILED",
    ]);
    expect(log.finish({ at: 5000, exitCode: 1, stopped: false })).toHaveLength(1);
    expect(log.finish({ at: 5000, exitCode: 1, stopped: false })[0].status).toBe("failed");
  });
});
