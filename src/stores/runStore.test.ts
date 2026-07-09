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

const ingest = (...lines: string[]) => {
  for (const l of lines) useRunStore.getState().ingestLine(l);
};
const statuses = () => useRunStore.getState().steps.map((s) => s.status);

describe("runStore.steps", () => {
  beforeEach(() => {
    useRunStore.getState().resetSteps();
    useRunStore.setState({
      logs: [],
      running: false,
      pid: null,
      exitCode: null,
      expectedFlow: null,
      flowGateOpen: true,
      pendingErrorIdx: null,
    });
  });

  it("initSteps populates with pending status", () => {
    useRunStore.getState().initSteps(mkSteps());
    const steps = useRunStore.getState().steps;
    expect(steps).toHaveLength(3);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps[0]).toMatchObject({ index: 0, line: 3, command: "launchApp", status: "pending" });
  });

  it("completed marks the step done and promotes the next one to running", () => {
    // Piped maestro never emits a "started" line for leaf commands — the blue
    // marker must be synthesized on the next pending step.
    useRunStore.getState().initSteps(mkSteps());
    ingest(`Launch app "com.example"... COMPLETED`);
    expect(statuses()).toEqual(["done", "running", "pending"]);
    expect(useRunStore.getState().steps[0].durationMs).not.toBeNull();
  });

  it("the flow header resets statuses and shows the first step running", () => {
    useRunStore.getState().initSteps(mkSteps());
    ingest(" > Flow my-flow");
    expect(statuses()).toEqual(["running", "pending", "pending"]);
  });

  it("full sequential transcript drives every step in order", () => {
    useRunStore.getState().initSteps(mkSteps());
    ingest(
      "Running on iPhone 16 Pro - iOS 18.2 - 1D5972C2",
      " > Flow test",
      `Launch app "com.example"... COMPLETED`,
      `Tap on "Login"... COMPLETED`,
      `Tap on "Login"... COMPLETED`,
    );
    expect(statuses()).toEqual(["done", "done", "done"]);
  });

  it("failed sets error from the same-line trailer when present", () => {
    useRunStore.getState().initSteps(mkSteps());
    ingest(`Launch app "com.example"... COMPLETED`, `Tap on "Login"... FAILED Element not found`);
    const s = useRunStore.getState().steps[1];
    expect(s.status).toBe("failed");
    expect(s.error).toBe("Element not found");
  });

  it("failed adopts the next free-text line as error detail (2.5.x format)", () => {
    // Real 2.5.1 output: the FAILED line is bare; the message arrives later.
    useRunStore.getState().initSteps([
      { index: 0, line: 3, endLine: 3, command: "launchApp", arg: "com.example" },
      { index: 1, line: 4, endLine: 4, command: "assertVisible", arg: "NopeNotHere999" },
    ]);
    ingest(
      `Launch app "com.example"... COMPLETED`,
      `Assert that "NopeNotHere999" is visible... FAILED`,
      ``,
      `Assertion is false: "NopeNotHere999" is visible`,
      ``,
      `Possible causes:`,
    );
    const s = useRunStore.getState().steps[1];
    expect(s.status).toBe("failed");
    expect(s.error).toBe(`Assertion is false: "NopeNotHere999" is visible`);
  });

  it("with duplicate steps, events settle them in order", () => {
    useRunStore.getState().initSteps(mkSteps());
    ingest(`Tap on "Login"... COMPLETED`, `Tap on "Login"... COMPLETED`);
    const steps = useRunStore.getState().steps;
    expect(steps[1].status).toBe("done");
    expect(steps[2].status).toBe("done");
  });

  it("unrecognized descriptions (label:) settle the cursor step positionally", () => {
    useRunStore.getState().initSteps(mkSteps());
    ingest(
      `Launch app "com.example"... COMPLETED`,
      // A YAML `label:` replaces the whole description — no pattern can match.
      `Se connecter au compte... COMPLETED`,
    );
    expect(statuses()).toEqual(["done", "done", "running"]);
  });

  it("aliased descriptions apply to the cursor (extendedWaitUntil prints as assert)", () => {
    useRunStore.getState().initSteps([
      { index: 0, line: 3, endLine: 3, command: "extendedWaitUntil", arg: "Ready" },
      { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Go" },
    ]);
    ingest(`Assert that "Ready" is visible... COMPLETED`);
    expect(statuses()).toEqual(["done", "running"]);
  });

  it("resyncs forward when a step emitted nothing, without ever matching backwards", () => {
    useRunStore.getState().initSteps([
      { index: 0, line: 3, endLine: 3, command: "swipe", arg: null },
      { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Login" },
    ]);
    // swipe's line was lost — the tapOn event must close it and match step 1.
    ingest(`Tap on "Login"... COMPLETED`);
    expect(statuses()).toEqual(["done", "done"]);
  });

  it("SKIPPED (when: not met) gets its own status", () => {
    useRunStore.getState().initSteps([
      { index: 0, line: 3, endLine: 3, command: "runFlow", arg: null },
      { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Go" },
    ]);
    ingest(`Run flow when false... SKIPPED`);
    expect(statuses()).toEqual(["skipped", "running"]);
  });

  it("resetSteps empties the array", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().resetSteps();
    expect(useRunStore.getState().steps).toEqual([]);
  });

  it("clearConsole empties BOTH logs and steps (Simple view reads steps)", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().appendLog("stdout", "hello");
    useRunStore.setState({ exitCode: 1, stopRequested: true });

    useRunStore.getState().clearConsole();

    const s = useRunStore.getState();
    expect(s.logs).toEqual([]);
    expect(s.steps).toEqual([]);
    expect(s.exitCode).toBeNull();
    expect(s.stopRequested).toBe(false);
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

  describe("containers (runFlow/repeat/retry) — indented children, real 2.5.1 transcript", () => {
    const stepsWithRunFlow = (): Step[] => [
      { index: 0, line: 1, endLine: 1, command: "launchApp", arg: "com.example" },
      { index: 1, line: 2, endLine: 5, command: "runFlow", arg: null },
      { index: 2, line: 6, endLine: 6, command: "back", arg: null },
    ];

    it("container start line marks the runFlow running; children don't touch parents", () => {
      useRunStore.getState().initSteps(stepsWithRunFlow());
      ingest(`Launch app "com.example"... COMPLETED`, `Run flow...`);
      expect(statuses()).toEqual(["done", "running", "pending"]);
      // REGRESSION (the historical "wrong lines turn green" bug): the subflow
      // contains a `back` just like the parent — the indented inner line must
      // NOT settle the parent's back step.
      ingest(`  Press back... COMPLETED`);
      expect(statuses()).toEqual(["done", "running", "pending"]);
    });

    it("container completion closes it; the parent then continues", () => {
      useRunStore.getState().initSteps(stepsWithRunFlow());
      ingest(
        `Launch app "com.example"... COMPLETED`,
        `Run flow...`,
        `  Press back... COMPLETED`,
        `Run flow... COMPLETED`,
        `Press back... COMPLETED`,
      );
      expect(statuses()).toEqual(["done", "done", "done"]);
    });

    it("nested containers (2+ depth) still only affect the top-level container", () => {
      useRunStore.getState().initSteps(stepsWithRunFlow());
      ingest(
        `Launch app "com.example"... COMPLETED`,
        `Run flow...`,
        `  Run flow...`,
        `    Press back... COMPLETED`,
        `  Run flow... COMPLETED`,
        `Run flow... FAILED`,
      );
      expect(statuses()).toEqual(["done", "failed", "pending"]);
    });

    it("repeat blocks re-emit inner commands without leapfrogging parent steps", () => {
      useRunStore.getState().initSteps([
        { index: 0, line: 1, endLine: 3, command: "repeat", arg: null },
        { index: 1, line: 4, endLine: 4, command: "tapOn", arg: "Next" },
      ]);
      ingest(
        `Repeat 3 times...`,
        `  Tap on "Next"... COMPLETED`,
        `  Tap on "Next"... COMPLETED`,
        `  Tap on "Next"... COMPLETED`,
        `Repeat 3 times... COMPLETED`,
        `Tap on "Next"... COMPLETED`,
      );
      expect(statuses()).toEqual(["done", "done"]);
    });
  });

  it("replays a full real 2.5.1 transcript (noise, banners, deferred error) correctly", () => {
    // Verbatim capture of `maestro test evidence2.yaml` (2026-07-09).
    useRunStore.getState().initSteps([
      { index: 0, line: 3, endLine: 3, command: "launchApp", arg: "com.apple.Preferences" },
      { index: 1, line: 4, endLine: 4, command: "evalScript", arg: "${1 + 1}" },
      { index: 2, line: 5, endLine: 8, command: "retry", arg: null },
      { index: 3, line: 9, endLine: 14, command: "runFlow", arg: null },
    ]);
    ingest(
      "Running on iPhone 16 Pro - iOS 18.2 - 1D5972C2-89CA-4F33-AE3D-7A9A8CD6094C",
      " > Flow evidence2",
      `Launch app "com.apple.Preferences"... COMPLETED`,
      "Run ${1 + 1}... COMPLETED",
      "Retry 1 times...",
      "  Press back... COMPLETED",
      "Retry 1 times... COMPLETED",
      "Run flow...",
      "  Run flow...",
      "    Press back... COMPLETED",
      "  Run flow... COMPLETED",
      `  Assert that "NopeNested999" is visible... FAILED`,
      "Run flow... FAILED",
      "",
      `Assertion is false: "NopeNested999" is visible`,
      "",
      `Assertion '"NopeNested999" is visible' failed. Check the UI hierarchy in debug artifacts to verify the element state and properties.`,
      "",
      "Possible causes:",
      "- Element selector may be incorrect - check if there are similar elements with slightly different names/properties.",
      "",
      "==== Debug output (logs & screenshots) ====",
      "",
      "/Users/ethanmorisset/.maestro/tests/2026-07-09_165303",
      "╭────────────────────────────────────────────╮",
      "│   Run your flows on Maestro Cloud:         │",
      "╰────────────────────────────────────────────╯",
    );
    expect(statuses()).toEqual(["done", "done", "done", "failed"]);
    expect(useRunStore.getState().steps[3].error).toBe(
      `Assertion is false: "NopeNested999" is visible`,
    );
  });

  describe("Run All gating (events from other flows must not bleed in)", () => {
    it("only the expected flow's lines drive the steps", () => {
      useRunStore.getState().initSteps(mkSteps());
      useRunStore.getState().setRunTarget({ path: "/ws", kind: "all", expectedFlow: "my-flow" });
      // Another flow in the folder runs first — with the same commands.
      ingest(
        " > Flow other-flow",
        `Launch app "com.example"... COMPLETED`,
        `Tap on "Login"... COMPLETED`,
      );
      expect(statuses()).toEqual(["pending", "pending", "pending"]);
      // Now ours runs.
      ingest(
        " > Flow my-flow",
        `Launch app "com.example"... COMPLETED`,
        `Tap on "Login"... COMPLETED`,
      );
      expect(statuses()).toEqual(["done", "done", "running"]);
      // A third flow afterwards must not disturb the final states.
      ingest(" > Flow zz-flow", `Tap on "Login"... COMPLETED`);
      expect(statuses()).toEqual(["done", "done", "running"]);
    });

    it("single-flow runs are never gated (temp-file names don't match)", () => {
      useRunStore.getState().initSteps(mkSteps());
      useRunStore.getState().setRunTarget({ path: "/tmp/maestro-deck-flow.yaml", kind: "flow" });
      ingest(" > Flow maestro-deck-flow", `Launch app "com.example"... COMPLETED`);
      expect(statuses()).toEqual(["done", "running", "pending"]);
    });
  });
});
