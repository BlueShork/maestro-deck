// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { summarizeBankReport } from "@/lib/bankReport";
import type { Comparison, RunReport } from "@/types/visualRegression";

const comp = (name: string, status: Comparison["status"], flow?: string): Comparison => ({
  name,
  flow,
  status,
  changed_ratio: 0,
  bbox: null,
});

const report = (comparisons: Comparison[], flow_errors?: string[]): RunReport => ({
  run_id: "r1",
  device_key: "Dev_2x2",
  comparisons,
  flow_errors,
});

describe("summarizeBankReport", () => {
  it("counts statuses", () => {
    const s = summarizeBankReport(
      report([
        comp("a", "match"),
        comp("b", "changed"),
        comp("c", "dimension_mismatch"),
        comp("d", "seeded"),
        comp("e", "missing"),
      ]),
    );
    expect(s.matched).toBe(1);
    expect(s.reviewable).toBe(2); // changed + dimension_mismatch
    expect(s.seeded).toBe(1);
    expect(s.missing).toBe(1);
  });

  it("emits an info toast when there is something to review", () => {
    const s = summarizeBankReport(report([comp("a", "changed")]));
    expect(s.toast.kind).toBe("info");
  });

  it("emits a success toast when clean", () => {
    const s = summarizeBankReport(report([comp("a", "match")]));
    expect(s.toast.kind).toBe("success");
    expect(s.toast.detail).toContain("1 match");
  });

  it("includes per-flow error log lines", () => {
    const s = summarizeBankReport(report([], ["checkout: boom"]));
    expect(s.logLines.some((l) => l.includes("checkout: boom"))).toBe(true);
  });

  it("adds a per-flow breakdown line when comparisons span several flows", () => {
    const s = summarizeBankReport(
      report([comp("a", "match", "login"), comp("b", "changed", "checkout")]),
    );
    expect(s.logLines.some((l) => l.includes("login") && l.includes("checkout"))).toBe(true);
  });
});
