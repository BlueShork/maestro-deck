// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: { workspaceGitBranch: vi.fn(async () => "main") } }));

import { useDeviceStore } from "@/stores/deviceStore";
import { useFlowStore } from "@/stores/flowStore";
import { useRunReportStore } from "@/stores/runReportStore";
import { useRunStore } from "@/stores/runStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

import { startRunReportTracking } from "./track";

const flush = () => new Promise((r) => setTimeout(r, 0));
let stop: () => void;

beforeEach(() => {
  useRunReportStore.setState({ last: null, flows: [] });
  useRunStore.setState({ running: false, starting: false, stopRequested: false, steps: [] });
  useWorkspaceStore.setState({ folderPath: "/Users/me/shop" });
  useDeviceStore.setState({
    current: {
      serial: "x",
      model: "Pixel 8",
      android_version: "15",
      screen_width: 1,
      screen_height: 1,
      platform: "android",
      os_version: "15",
      booted: true,
      physical: true,
    },
  });
  stop = startRunReportTracking();
});
afterEach(() => stop());

async function runAll(lines: string[], exitCode: number) {
  const run = useRunStore.getState();
  run.setStarting();
  run.setRunTarget({ path: "/Users/me/shop", kind: "all", expectedFlow: null });
  run.setRunning(42);
  lines.forEach((l) => useRunReportStore.getState().ingest(l));
  useRunStore.getState().setStopped(exitCode);
  await flush();
}

describe("startRunReportTracking", () => {
  it("records a Run All report with every flow, beyond the console buffer", async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `[Passed] flow-${i} (1s)`);
    await runAll(lines, 0);
    const r = useRunReportStore.getState().last!;
    expect(r.kind).toBe("all");
    expect(r.items).toHaveLength(3000);
    expect(r.title).toBe("shop");
    expect(r.project).toEqual({ name: "shop", branch: "main" });
    expect(r.device).toEqual({ platform: "android", name: "Pixel 8" });
    expect(r.status).toBe("passed");
  });

  it("resets the collected flows when the next run starts", async () => {
    await runAll(["[Failed] a (1s) (boom)"], 1);
    await runAll(["[Passed] b (1s)"], 0);
    expect(useRunReportStore.getState().last!.items.map((i) => i.name)).toEqual(["b"]);
  });

  it("reports a single run from the open flow's steps", async () => {
    useFlowStore.setState({
      content: "appId: x\nname: Login\n---\n- tapOn: Go\n",
      filePath: "/f/login.yaml",
    });
    const run = useRunStore.getState();
    run.setStarting();
    run.initSteps([{ index: 0, line: 4, endLine: 4, command: "tapOn", arg: "Go" }]);
    run.setRunTarget({ path: "/f/login.yaml", kind: "flow" });
    run.setRunning(7);
    run.ingestLine('Tap on "Go"... COMPLETED');
    useRunStore.getState().setStopped(0);
    await flush();
    const r = useRunReportStore.getState().last!;
    expect(r.kind).toBe("flow");
    expect(r.title).toBe("Login");
    expect(r.items[0]).toMatchObject({ name: 'tapOn "Go"', status: "passed" });
  });

  it("does not report a run that never started", async () => {
    useRunStore.getState().setStarting();
    useRunStore.getState().startFailed();
    await flush();
    expect(useRunReportStore.getState().last).toBeNull();
  });
});
