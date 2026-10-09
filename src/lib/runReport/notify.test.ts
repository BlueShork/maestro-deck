// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({ ipc: {} }));

import type { InstalledPlugin } from "@/lib/plugins/types";
import { usePluginsStore } from "@/stores/pluginsStore";
import { useRunReportStore } from "@/stores/runReportStore";
import { useToastStore } from "@/stores/toastStore";

import { startReportNotifications } from "./notify";
import type { RunReport } from "./types";

const plugin = (id: string, runs: boolean): InstalledPlugin => ({
  id,
  version: "1.0.0",
  dev: false,
  error: null,
  manifest: {
    id,
    name: id === "reportly" ? "Reportly" : id,
    version: "1.0.0",
    minAppVersion: "1.3.0",
    entry: "index.html",
    panel: { title: id },
    permissions: { http: [], open: [], secrets: false, runs },
  },
});
const report = (over: Partial<RunReport> = {}) =>
  ({
    id: crypto.randomUUID(),
    status: "failed",
    kind: "all",
    totals: { passed: 3, failed: 2, skipped: 0 },
    ...over,
  }) as RunReport;
let stop: () => void;

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  usePluginsStore.setState({
    installed: [plugin("jira", false), plugin("reportly", true)],
    openPanel: null,
  });
  stop = startReportNotifications();
});
afterEach(() => stop());

describe("startReportNotifications", () => {
  it("offers to open the first plugin that reads runs, with the outcome", () => {
    useRunReportStore.getState().finish(report());
    const [t] = useToastStore.getState().toasts;
    expect(t.title).toBe("Reportly report ready");
    expect(t.description).toBe("2 failed · 3 passed");
    expect(t.variant).toBe("error");
    t.action!.onClick();
    expect(usePluginsStore.getState().openPanel).toBe("reportly");
  });

  it("says when everything passed or the run was stopped", () => {
    useRunReportStore
      .getState()
      .finish(report({ status: "passed", totals: { passed: 4, failed: 0, skipped: 0 } }));
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      description: "4 passed",
      variant: "success",
    });
    useToastStore.setState({ toasts: [] });
    useRunReportStore.getState().finish(report({ status: "stopped" }));
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      description: "Run stopped",
      variant: "default",
    });
  });

  it("stays quiet when that panel is already open", () => {
    usePluginsStore.setState({ openPanel: "reportly" });
    useRunReportStore.getState().finish(report());
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("stays quiet when no plugin reads runs", () => {
    usePluginsStore.setState({ installed: [plugin("jira", false)] });
    useRunReportStore.getState().finish(report());
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
