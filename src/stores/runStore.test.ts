// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, it, expect, beforeEach } from "vitest";
import { useRunStore } from "./runStore";
import type { Step } from "@/lib/flowAst";

const mkSteps = (): Step[] => [
  { index: 0, line: 3, endLine: 3, command: "launchApp", arg: "com.example" },
  { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Login" },
  { index: 2, line: 5, endLine: 5, command: "tapOn", arg: "Login" },
];

describe("runStore.steps", () => {
  beforeEach(() => {
    useRunStore.getState().resetSteps();
    useRunStore.setState({ logs: [], running: false, pid: null, exitCode: null });
  });

  it("initSteps populates with pending status", () => {
    useRunStore.getState().initSteps(mkSteps());
    const steps = useRunStore.getState().steps;
    expect(steps).toHaveLength(3);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps[0]).toMatchObject({ index: 0, line: 3, command: "launchApp", status: "pending" });
  });

  it("applyEvent transitions started → running", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore
      .getState()
      .applyEvent({ kind: "started", command: "launchApp", arg: "com.example" });
    expect(useRunStore.getState().steps[0].status).toBe("running");
    expect(useRunStore.getState().steps[0].startedAt).not.toBeNull();
  });

  it("applyEvent transitions completed → done with duration", async () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore
      .getState()
      .applyEvent({ kind: "started", command: "launchApp", arg: "com.example" });
    await new Promise((r) => setTimeout(r, 5));
    useRunStore
      .getState()
      .applyEvent({ kind: "completed", command: "launchApp", arg: "com.example" });
    const s = useRunStore.getState().steps[0];
    expect(s.status).toBe("done");
    expect(s.durationMs).not.toBeNull();
    expect(s.durationMs!).toBeGreaterThanOrEqual(0);
  });

  it("applyEvent failed sets error", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "started", command: "tapOn", arg: "Login" });
    useRunStore
      .getState()
      .applyEvent({ kind: "failed", command: "tapOn", arg: "Login", error: "Element not found" });
    const s = useRunStore.getState().steps[1];
    expect(s.status).toBe("failed");
    expect(s.error).toBe("Element not found");
  });

  it("with duplicate steps, falls back to first pending match", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "completed", command: "tapOn", arg: "Login" });
    useRunStore.getState().applyEvent({ kind: "completed", command: "tapOn", arg: "Login" });
    const steps = useRunStore.getState().steps;
    expect(steps[1].status).toBe("done");
    expect(steps[2].status).toBe("done");
  });

  it("applyEvent with unknown command is a no-op", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "completed", command: "weirdThing", arg: "x" });
    const steps = useRunStore.getState().steps;
    expect(steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("resetSteps empties the array", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().resetSteps();
    expect(useRunStore.getState().steps).toEqual([]);
  });

  describe("start lifecycle (optimistic 'starting' state)", () => {
    beforeEach(() => {
      useRunStore.setState({ running: false, starting: false, pid: null, exitCode: null });
    });

    it("setStarting flips to starting without a pid and clears logs", () => {
      useRunStore.getState().appendLog("system", "stale");
      useRunStore.getState().setStarting();
      const s = useRunStore.getState();
      expect(s.starting).toBe(true);
      expect(s.running).toBe(false);
      expect(s.pid).toBeNull();
      expect(s.logs).toEqual([]);
    });

    it("setRunning resolves starting → running and keeps logs streamed in between", () => {
      useRunStore.getState().setStarting();
      useRunStore.getState().appendLog("stdout", "early line");
      useRunStore.getState().setRunning(4242);
      const s = useRunStore.getState();
      expect(s.starting).toBe(false);
      expect(s.running).toBe(true);
      expect(s.pid).toBe(4242);
      // setRunning must NOT clear logs, or early runner stdout is dropped.
      expect(s.logs.map((l) => l.text)).toEqual(["early line"]);
    });

    it("startFailed reverts to idle", () => {
      useRunStore.getState().setStarting();
      useRunStore.getState().startFailed();
      const s = useRunStore.getState();
      expect(s.starting).toBe(false);
      expect(s.running).toBe(false);
      expect(s.pid).toBeNull();
    });

    it("setStopped clears both running and starting", () => {
      useRunStore.getState().setRunning(7);
      useRunStore.getState().setStopped(0);
      const s = useRunStore.getState();
      expect(s.running).toBe(false);
      expect(s.starting).toBe(false);
      expect(s.pid).toBeNull();
      expect(s.exitCode).toBe(0);
    });
  });

  describe("runFlow heuristic (Maestro inlines subflow steps without a header)", () => {
    const stepsWithRunFlow = (): Step[] => [
      { index: 0, line: 1, endLine: 1, command: "launchApp", arg: "com.example" },
      { index: 1, line: 2, endLine: 5, command: "runFlow", arg: null },
      { index: 2, line: 6, endLine: 6, command: "tapOn", arg: "After" },
    ];

    it("marks runFlow as running when an unknown-to-parent step starts", () => {
      useRunStore.getState().initSteps(stepsWithRunFlow());
      useRunStore
        .getState()
        .applyEvent({ kind: "completed", command: "launchApp", arg: "com.example" });
      // Now cursor sits on the runFlow. An inner subflow step ("Tap on
      // Env Switcher") arrives — the parent has no such step, so it must
      // mark the runFlow as running.
      useRunStore.getState().applyEvent({ kind: "started", command: "tapOn", arg: "Env Switcher" });
      const steps = useRunStore.getState().steps;
      expect(steps[0].status).toBe("done");
      expect(steps[1].status).toBe("running");
    });

    it("closes runFlow as done when the next parent step starts", () => {
      useRunStore.getState().initSteps(stepsWithRunFlow());
      useRunStore
        .getState()
        .applyEvent({ kind: "completed", command: "launchApp", arg: "com.example" });
      useRunStore.getState().applyEvent({ kind: "started", command: "tapOn", arg: "Env Switcher" });
      // Parent step matches — runFlow at index 1 must now be done.
      useRunStore.getState().applyEvent({ kind: "started", command: "tapOn", arg: "After" });
      const steps = useRunStore.getState().steps;
      expect(steps[1].status).toBe("done");
      expect(steps[2].status).toBe("running");
    });

    it("two consecutive runFlows both close when next parent step matches", () => {
      const arr: Step[] = [
        { index: 0, line: 1, endLine: 1, command: "runFlow", arg: null },
        { index: 1, line: 2, endLine: 2, command: "runFlow", arg: null },
        { index: 2, line: 3, endLine: 3, command: "tapOn", arg: "End" },
      ];
      useRunStore.getState().initSteps(arr);
      // Inner subflow event → first runFlow becomes running
      useRunStore.getState().applyEvent({ kind: "started", command: "tapOn", arg: "Inner1" });
      // Parent step matches → all preceding runFlows must be closed
      useRunStore.getState().applyEvent({ kind: "started", command: "tapOn", arg: "End" });
      const steps = useRunStore.getState().steps;
      expect(steps[0].status).toBe("done");
      expect(steps[1].status).toBe("done");
      expect(steps[2].status).toBe("running");
    });
  });
});
