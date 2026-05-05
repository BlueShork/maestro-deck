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
    useRunStore.getState().applyEvent({ kind: "started", command: "launchApp", arg: "com.example" });
    expect(useRunStore.getState().steps[0].status).toBe("running");
    expect(useRunStore.getState().steps[0].startedAt).not.toBeNull();
  });

  it("applyEvent transitions completed → done with duration", async () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "started", command: "launchApp", arg: "com.example" });
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
    useRunStore
      .getState()
      .applyEvent({ kind: "started", command: "tapOn", arg: "Login" });
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
});
