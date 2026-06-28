// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { MainView } from "@/components/MainView";
import { QuitConfirmDialog } from "@/components/QuitConfirmDialog";
import { SettingsPage } from "@/components/settings/SettingsPage";
import { UpdateDialog } from "@/components/UpdateDialog";
import { Toaster } from "@/components/ui/Toast";
import { openFlowFile } from "@/lib/flow-io";
import { events, ipc } from "@/lib/ipc";
import { setShortcutsSuppressed } from "@/lib/keyboard";
import { parseLine as parseRunLine } from "@/lib/runStepParser";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useDeviceStore } from "@/stores/deviceStore";
import { useReviewStore } from "@/stores/reviewStore";
import { effectiveThresholds } from "@/stores/visualRegressionStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useMetricsStore } from "@/stores/metricsStore";
import { usePanelsStore } from "@/stores/panelsStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast, useToastStore } from "@/stores/toastStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * App shell. Owns the app-wide, route-independent effects (runner event
 * listeners, theme, startup update check, stream/metrics lifecycle, driver
 * recovery toasts) so they keep running while the user is on any route —
 * notably the full-screen settings page.
 *
 * `MainView` stays mounted at all times (just hidden behind the settings page)
 * so returning to the workspace is instant — remounting it would rebuild the
 * CodeMirror editor and the H.264 decoder from scratch, which is what made the
 * back transition feel slow. Its global keyboard shortcuts are suppressed while
 * settings is open so they don't fire from behind the overlay.
 */
export default function App() {
  const location = useLocation();
  const settingsOpen = location.pathname.startsWith("/settings");
  useEffect(() => {
    setShortcutsSuppressed(settingsOpen);
    return () => setShortcutsSuppressed(false);
  }, [settingsOpen]);
  const theme = useSettingsStore((s) => s.theme);
  const markDisconnected = useDeviceStore((s) => s.markDisconnected);
  const appendLog = useRunStore((s) => s.appendLog);
  const applyStepEvent = useRunStore((s) => s.applyEvent);
  const setStopped = useRunStore((s) => s.setStopped);

  // Restore the last opened file from the previous session. The workspace
  // store hydrates synchronously from localStorage, so the path is available
  // on first effect tick.
  useEffect(() => {
    const last = useWorkspaceStore.getState().lastOpenFile;
    if (last) void openFlowFile(last, { silent: true });
  }, []);

  // Silent update check on startup. Skipped if the user disabled it in
  // Settings. Failure is non-fatal — we just don't surface the toast.
  useEffect(() => {
    if (!useSettingsStore.getState().autoCheckUpdatesEnabled) return;
    const t = setTimeout(() => {
      void useUpdateStore.getState().check({ silent: true });
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  // React to streamEnabled toggles while a device is connected: spin up or
  // tear down scrcpy live without forcing the user to disconnect/reconnect.
  // Skip the initial render — connect_device already passed the right flag.
  const streamEnabled = useSettingsStore((s) => s.streamEnabled);
  const prevStreamEnabledRef = useRef(streamEnabled);
  useEffect(() => {
    if (prevStreamEnabledRef.current === streamEnabled) return;
    prevStreamEnabledRef.current = streamEnabled;
    const current = useDeviceStore.getState().current;
    if (!current) return;
    if (streamEnabled) {
      ipc
        .startStream()
        .then(() => toast.success("Stream on"))
        .catch((err) =>
          toast.error("Start stream failed", err instanceof Error ? err.message : String(err)),
        );
    } else {
      ipc
        .stopStream()
        .then(() => {
          useStreamStore.getState().reset();
          toast.success("Stream off");
        })
        .catch((err) =>
          toast.error("Stop stream failed", err instanceof Error ? err.message : String(err)),
        );
    }
  }, [streamEnabled]);

  // Reset inspect mode whenever the connected device changes (switch, connect,
  // or disconnect). The inspector state is global, not per-device — without
  // this, switching devices leaves a stale tree and can strand `loading` on a
  // dump that targeted the previous device.
  const currentSerial = useDeviceStore((s) => s.current?.serial ?? null);
  useEffect(() => {
    useInspectorStore.getState().disable();
  }, [currentSerial]);

  const appendSample = useMetricsStore((s) => s.appendSample);
  const onTargetChanged = useMetricsStore((s) => s.onTargetChanged);
  const setStoppedReason = useMetricsStore((s) => s.setStoppedReason);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let cancelled = false;
    Promise.all([
      events.onRunnerStdout((line) => {
        appendLog("stdout", line);
        const ev = parseRunLine(line);
        if (ev) applyStepEvent(ev);
      }),
      events.onRunnerStderr((line) => appendLog("stderr", line)),
      events.onRunnerExit(({ code }) => {
        const wasStopped = useRunStore.getState().stopRequested;
        const exitedPid = useRunStore.getState().pid;
        appendLog(
          "system",
          wasStopped ? "[runner stopped by user]" : `[runner exited with code ${code}]`,
        );
        setStopped(code);
        if (wasStopped) toast.success("Flow stopped");
        else if (code === 0) toast.success("Flow completed");
        else toast.error("Flow failed", `exit code ${code}`);
        if (code === 0 && !wasStopped) {
          const target = useRunStore.getState().runTarget;
          const ws = useWorkspaceStore.getState().folderPath;
          const device = useDeviceStore.getState().current;
          if (target?.kind === "all") {
            appendLog("system", "[bank] comparaison de banque ignorée pour Run All (non supporté dans cette version)");
          } else if (target?.kind === "flow" && ws && device) {
            const { tolerance, threshold } = effectiveThresholds();
            const runId = String(exitedPid ?? Date.now());
            void ipc
              .compareScreenshots({
                workspace: ws,
                flowPath: target.path,
                model: device.model,
                width: device.screen_width,
                height: device.screen_height,
                tolerance,
                threshold,
                runId,
              })
              .then((report) => useReviewStore.getState().setReport(report))
              .catch((err) => appendLog("system", `[bank] échec comparaison: ${String(err)}`));
          }
        }
      }),
      events.onDeviceDisconnected(() => markDisconnected()),
      events.onMetricsSample((p) =>
        appendSample({
          ts: p.ts,
          cpuPct: p.cpu_pct,
          memMb: p.mem_mb,
          fps: p.fps,
          jankPct: p.jank_pct,
          frameP50: p.frame_p50_ms,
          frameP90: p.frame_p90_ms,
          frameP95: p.frame_p95_ms,
          frameP99: p.frame_p99_ms,
          thermalStatus: p.thermal_status,
          netRxKbps: p.net_rx_kbps,
          netTxKbps: p.net_tx_kbps,
        }),
      ),
      events.onMetricsTargetChanged((p) => onTargetChanged(p.to)),
      events.onMetricsStopped((p) => setStoppedReason(p.reason === "user" ? null : p.reason)),
    ]).then((fns) => {
      if (cancelled) fns.forEach((fn) => fn());
      else cleanups = fns;
    });
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [
    appendLog,
    applyStepEvent,
    setStopped,
    markDisconnected,
    appendSample,
    onTargetChanged,
    setStoppedReason,
  ]);

  useEffect(() => {
    let toastId: string | null = null;
    const unlistenRecovering = listen<{ device_id: string; action: string }>(
      "driver-recovering",
      () => {
        // dismiss any prior recovery toast in case events arrive out of order
        if (toastId) {
          useToastStore.getState().dismiss(toastId);
        }
        toastId = useToastStore.getState().push({
          title: "Recovering driver…",
          description: "Maestro driver was unresponsive — restarting it.",
          variant: "default",
          persistent: true,
        });
      },
    );
    const unlistenRecovered = listen<{ device_id: string }>("driver-recovered", () => {
      if (toastId) {
        useToastStore.getState().dismiss(toastId);
        toastId = null;
      }
    });
    return () => {
      void unlistenRecovering.then((u) => u());
      void unlistenRecovered.then((u) => u());
      if (toastId) {
        useToastStore.getState().dismiss(toastId);
      }
    };
  }, []);

  const metricsOpen = usePanelsStore((s) => s.visible.metrics);
  // Use device identity (serial + platform + physical) rather than mere presence
  // so that a direct A→B switch (where deviceConnected stays true) still causes
  // the effect to re-run, stopping the old collector and starting a new one for
  // the correct device.
  const deviceKey = useDeviceStore((s) =>
    s.current ? `${s.current.serial}:${s.current.platform}:${String(s.current.physical)}` : null,
  );

  useEffect(() => {
    if (!metricsOpen || !deviceKey) {
      void ipc.stopMetrics().catch(() => {});
      return;
    }
    // Clear any stale samples/package from a previous device so nothing is
    // misattributed while we wait for the new collector's first sample.
    useMetricsStore.getState().reset();
    void ipc.startMetrics().catch((err) => {
      toast.error(
        "Performance monitoring failed to start",
        err instanceof Error ? err.message : String(err),
      );
    });
    return () => {
      void ipc.stopMetrics().catch(() => {});
    };
  }, [metricsOpen, deviceKey]);

  return (
    <>
      {/* Always mounted; hidden (not unmounted) while settings is open so the
          editor + video decoder survive and returning is instant. */}
      <div className={settingsOpen ? "hidden" : "contents"}>
        <MainView />
      </div>
      <Routes>
        <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
        <Route path="/settings/:section" element={<SettingsPage />} />
        {/* MainView already covers "/"; redirect any other unknown path there. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdateDialog />
      <QuitConfirmDialog />
      <Toaster />
    </>
  );
}
