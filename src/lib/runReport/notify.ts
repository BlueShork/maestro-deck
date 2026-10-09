// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { usePluginsStore } from "@/stores/pluginsStore";
import { useRunReportStore } from "@/stores/runReportStore";
import { toast } from "@/stores/toastStore";

import type { RunReport } from "./types";

function outcome(r: RunReport): string {
  if (r.status === "stopped") return "Run stopped";
  const { passed, failed } = r.totals;
  return [failed && `${failed} failed`, `${passed} passed`].filter(Boolean).join(" · ");
}

/** When a run ends, points the user at the plugin that turns it into a
 *  report. It replaces the run's own "completed/failed" toast, so it carries
 *  the outcome. Silent when that plugin's panel is already open: it
 *  refreshes itself from the run.finished event. */
export function startReportNotifications(): () => void {
  return useRunReportStore.subscribe((s, prev) => {
    if (!s.last || s.last === prev.last) return;
    const { installed, openPanel, openPluginPanel } = usePluginsStore.getState();
    const reader = installed.find((p) => p.manifest?.permissions.runs && p.manifest.panel);
    if (!reader?.manifest || openPanel === reader.id) return;
    const show =
      s.last.status === "passed"
        ? toast.success
        : s.last.status === "failed"
          ? toast.error
          : toast.info;
    show(`${reader.manifest.name} report ready`, outcome(s.last), {
      label: "Open",
      onClick: () => openPluginPanel(reader.id),
    });
  });
}
