import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { snapshotOf } from "@/test/snapshot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useRunStore, type StepRunState } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";

import { RunConsole } from "./RunConsole";

vi.mock("@/components/MetricsPanel", () => ({ MetricsBody: () => <div>metrics body</div> }));

const step = (index: number, over: Partial<StepRunState>): StepRunState => ({
  index,
  line: index + 3,
  endLine: index + 3,
  command: "tapOn",
  arg: `Button ${index}`,
  status: "pending",
  startedAt: null,
  durationMs: null,
  error: null,
  ...over,
});

beforeEach(() => {
  useSettingsStore.setState({ consoleMode: "simple" });
  useRunStore.setState({
    running: false,
    starting: false,
    pid: null,
    exitCode: null,
    stopRequested: false,
    logs: [],
    truncatedCount: 0,
    steps: [],
    cloud: null,
  });
});
afterEach(() => cleanup());

describe("RunConsole — simple view", () => {
  it("invites a first run when there is nothing yet, and Clear is disabled", () => {
    render(<RunConsole />);
    expect(screen.getByText(/No output yet/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Clear/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("lists steps with their state, duration and failure detail", () => {
    useRunStore.setState({
      exitCode: 1,
      steps: [
        step(0, { command: "launchApp", arg: "com.app", status: "done", durationMs: 1200 }),
        step(1, { status: "failed", durationMs: 300, error: "Element not found" }),
        step(2, { status: "pending" }),
      ],
    });
    const { container } = render(<RunConsole />);
    expect(screen.getByText(/Test failed/)).toBeTruthy();
    expect(screen.getByText(/at step 2/)).toBeTruthy();
    expect(screen.getByTitle("Element not found")).toBeTruthy();
    expect(container.querySelectorAll(".step-pip-done")).toHaveLength(1);
    expect(container.querySelectorAll(".step-pip-failed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("summarises a passing run with the step count", () => {
    useRunStore.setState({
      exitCode: 0,
      steps: [
        step(0, { status: "done", durationMs: 500 }),
        step(1, { status: "done", durationMs: 700 }),
      ],
    });
    render(<RunConsole />);
    expect(screen.getByText("Test passed")).toBeTruthy();
    expect(screen.getByText(/2 steps in/)).toBeTruthy();
  });

  it("says stopped, not failed, when the user stopped the run", () => {
    useRunStore.setState({
      exitCode: 137,
      stopRequested: true,
      steps: [step(0, { status: "done", durationMs: 1 })],
    });
    render(<RunConsole />);
    expect(screen.getByText("Test stopped")).toBeTruthy();
    expect(screen.queryByText("Test failed")).toBeNull();
  });

  it("Clear empties steps and logs, and is disabled while running", () => {
    useRunStore.setState({ steps: [step(0, { status: "done" })], exitCode: 0 });
    useRunStore.getState().appendLog("stdout", "x");
    render(<RunConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Clear/ }));
    expect(useRunStore.getState()).toMatchObject({ steps: [], logs: [], exitCode: null });

    act(() => useRunStore.setState({ running: true, steps: [step(0, { status: "running" })] }));
    expect((screen.getByRole("button", { name: /Clear/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("RunConsole — technical view", () => {
  beforeEach(() => useSettingsStore.setState({ consoleMode: "technical" }));

  it("shows each stream with its own styling and renders ANSI colours", () => {
    const { appendLog } = useRunStore.getState();
    appendLog("stdout", "\u001b[32mgreen\u001b[0m plain");
    appendLog("stderr", "boom");
    appendLog("system", "[runner exited with code 1]");
    render(<RunConsole />);
    expect(screen.getByText("green").className).toContain("text-green-400");
    expect(screen.getByText("boom").closest("div")!.className).toContain("text-destructive");
    expect(screen.getByText("[runner exited with code 1]").closest("div")!.className).toContain(
      "italic",
    );
  });

  it("mentions dropped lines once the cap was hit", () => {
    useRunStore.setState({ truncatedCount: 12 });
    useRunStore.getState().appendLog("stdout", "kept");
    render(<RunConsole />);
    expect(screen.getByText(/12 older lines dropped/)).toBeTruthy();
  });

  it("appends streamed lines without re-creating the rows already shown", () => {
    useRunStore.getState().appendLog("stdout", "first");
    render(<RunConsole />);
    const firstRow = screen.getByText("first").closest("div");
    act(() => {
      useRunStore.getState().queueLog("stdout", "second");
      useRunStore.getState().flushLogs();
    });
    expect(screen.getByText("second")).toBeTruthy();
    expect(screen.getByText("first").closest("div")).toBe(firstRow);
  });

  it("switching tabs persists the console mode", () => {
    render(<RunConsole />);
    fireEvent.click(screen.getByRole("button", { name: /Performance/ }));
    expect(useSettingsStore.getState().consoleMode).toBe("performance");
    expect(screen.getByText("metrics body")).toBeTruthy();
  });
});

describe("RunConsole snapshots", () => {
  it("empty console", () => {
    const { container } = render(<RunConsole />);
    expect(snapshotOf(container.firstChild as Element)).toMatchSnapshot();
  });

  it("finished run with a failed step", () => {
    useRunStore.setState({
      exitCode: 1,
      steps: [
        step(0, { command: "launchApp", arg: "com.app", status: "done", durationMs: 1200 }),
        step(1, { status: "skipped", durationMs: 0 }),
        step(2, { status: "failed", durationMs: 300, error: "Element not found" }),
        step(3, {}),
      ],
    });
    const { container } = render(<RunConsole />);
    expect(snapshotOf(container.firstChild as Element)).toMatchSnapshot();
  });

  it("technical log", () => {
    useSettingsStore.setState({ consoleMode: "technical" });
    useRunStore.setState({
      logs: [
        { id: 1, stream: "system", text: "[runner started pid 42]", timestamp: 0 },
        {
          id: 2,
          stream: "stdout",
          text: "\u001b[33mLaunch app\u001b[0m... COMPLETED",
          timestamp: 0,
        },
        { id: 3, stream: "stderr", text: "warning: slow device", timestamp: 0 },
      ],
      truncatedCount: 3,
    });
    const { container } = render(<RunConsole />);
    expect(snapshotOf(container.firstChild as Element)).toMatchSnapshot();
  });
});
