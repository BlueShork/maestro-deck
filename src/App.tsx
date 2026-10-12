// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { listen } from "@tauri-apps/api/event";
import { lazy, Suspense, useEffect, useRef } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { CloudInviteDialog } from "@/components/CloudInviteDialog";
import { DevicePicker } from "@/components/devices/DevicePicker";
import { OriginGrantDialog } from "@/components/plugins/OriginGrantDialog";
import { isFullPage } from "@/lib/fullPage";
import { MainView } from "@/components/MainView";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { QuitConfirmDialog } from "@/components/QuitConfirmDialog";
import { SetupPopup } from "@/components/SetupPopup";
import { TelemetryConsentDialog } from "@/components/TelemetryConsentDialog";
import { TourOverlay } from "@/components/TourOverlay";
import { UpdateDialog } from "@/components/UpdateDialog";
import { Toaster } from "@/components/ui/Toast";
import { openFlowFile } from "@/lib/flow-io";
import { events, ipc } from "@/lib/ipc";
import { setShortcutsSuppressed } from "@/lib/keyboard";
import { startReportNotifications } from "@/lib/runReport/notify";
import { handleRunnerExit } from "@/lib/runExit";
import { startRunReportTracking } from "@/lib/runReport/track";
import { useFarmStore } from "@/stores/farmStore";
import { screenName, setScreen, track } from "@/lib/telemetry";
import { startColorThemeSync } from "@/lib/plugins/colorThemeStartup";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { startCloudAuthListener } from "@/stores/cloudAuthStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useMetricsStore } from "@/stores/metricsStore";
import { usePanelsStore } from "@/stores/panelsStore";
import { useRunReportStore } from "@/stores/runReportStore";
import { useRunStore } from "@/stores/runStore";
import { activeColorTheme, useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { toast, useToastStore } from "@/stores/toastStore";
import { shouldAutoStartWalkthrough, useOnboardingStore } from "@/stores/onboardingStore";
import { useEnvStore } from "@/stores/envStore";
import { useTourStore } from "@/stores/tourStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

// Full pages open on demand: kept out of the startup bundle.
const AccountPage = lazy(() =>
  import("@/components/AccountPage").then((m) => ({ default: m.AccountPage })),
);
const ImageBankPage = lazy(() =>
  import("@/components/ImageBankPage").then((m) => ({ default: m.ImageBankPage })),
);
const PluginsPage = lazy(() =>
  import("@/components/plugins/PluginsPage").then((m) => ({ default: m.PluginsPage })),
);
const SettingsPage = lazy(() =>
  import("@/components/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);

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
  const pageOpen = isFullPage(location.pathname);
  // Farm session events (warnings, reconnect, endings) arrive from the native side.
  useEffect(() => {
    void useFarmStore.getState().start();
  }, []);

  // Records the last run as a RunReport for plugins with the `runs` permission.
  useEffect(() => startRunReportTracking(), []);
  useEffect(() => startReportNotifications(), []);

  useEffect(() => {
    setShortcutsSuppressed(pageOpen);
    return () => setShortcutsSuppressed(false);
  }, [pageOpen]);
  const theme = useSettingsStore((s) => s.theme);
  const activeTokens = useSettingsStore(activeColorTheme);
  const markDisconnected = useDeviceStore((s) => s.markDisconnected);
  const appendLog = useRunStore((s) => s.appendLog);
  const queueLog = useRunStore((s) => s.queueLog);
  const ingestLine = useRunStore((s) => s.ingestLine);

  // Restore the last opened file from the previous session. The workspace
  // store hydrates synchronously from localStorage, so the path is available
  // on first effect tick.
  useEffect(() => {
    const last = useWorkspaceStore.getState().lastOpenFile;
    if (last) void openFlowFile(last, { silent: true });
  }, []);

  useEffect(() => {
    setScreen(screenName(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    track("app_opened", {});
  }, []);

  const telemetryAnswered = useTelemetryStore((s) => s.consent !== null);
  useEffect(() => {
    if (telemetryAnswered && !useTourStore.getState().hasSeenTour) {
      useTourStore.getState().start();
    }
  }, [telemetryAnswered]);

  // Everyone should meet the hands-on walkthrough once, including the users
  // who went through the tour before it existed — their tour ended long ago
  // and will never hand over. It waits for the toolchain, since it ends on
  // "press Run". Marked done as soon as it is seen, so it never returns.
  const toolsReady = useEnvStore((s) => s.minimalOk === true);
  const walkthroughDone = useOnboardingStore((s) => s.done);
  useEffect(() => {
    if (
      telemetryAnswered &&
      shouldAutoStartWalkthrough({
        hasSeenTour: useTourStore.getState().hasSeenTour,
        walkthroughDone,
        toolsReady,
      })
    ) {
      useOnboardingStore.getState().start();
    }
  }, [telemetryAnswered, toolsReady, walkthroughDone]);

  // Optional Maestro Deck Cloud sign-in: Firebase persists the session
  // itself, this just keeps cloudAuthStore in sync with it.
  useEffect(() => {
    startCloudAuthListener();
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
    applyTheme(theme, activeTokens);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system", activeTokens));
  }, [theme, activeTokens]);

  // Theme plugins: load the installed list once, then keep the chosen theme's
  // cached tokens current (or fall back to the default if it disappeared).
  useEffect(() => startColorThemeSync(), []);

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
        queueLog("stdout", line);
        ingestLine(line);
        useRunReportStore.getState().ingest(line);
      }),
      events.onRunnerStderr((line) => {
        queueLog("stderr", line);
        useRunReportStore.getState().ingest(line);
      }),
      events.onRunnerExit(({ code }) => handleRunnerExit(code)),
      events.onDeviceDisconnected(() => markDisconnected()),
      events.onWebStatus((p) => {
        if (p.stage === "error") toast.error("Web browser", p.message);
        // toastStore has no warn variant — "warn" renders as info.
        else toast.info("Web browser", p.message);
      }),
      events.onWebTapFallback(() => {
        toast.info(
          "Tap sent as coordinates",
          "The page snapshot wasn't available — the tap may be less precise.",
        );
      }),
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
      useRunStore.getState().flushLogs();
    };
  }, [
    appendLog,
    queueLog,
    ingestLine,
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

  // Capture only while the console's Performance tab is on screen — it is the
  // only reader of the samples.
  const consoleVisible = usePanelsStore((s) => s.visible.console);
  const performanceTab = useSettingsStore((s) => s.consoleMode === "performance");
  const metricsOpen = consoleVisible && performanceTab;
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
      <div className={pageOpen ? "hidden" : "contents"}>
        <MainView />
      </div>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/settings" element={<Navigate to="/settings/general" replace />} />
          <Route path="/settings/:section" element={<SettingsPage />} />
          <Route path="/image-bank" element={<ImageBankPage />} />
          <Route path="/plugins" element={<PluginsPage />} />
          <Route path="/account" element={<AccountPage />} />
          {/* MainView already covers "/"; redirect any other unknown path there. */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <TelemetryConsentDialog />
      <UpdateDialog />
      <CloudInviteDialog />
      <QuitConfirmDialog />
      <OriginGrantDialog />
      <TourOverlay />
      <OnboardingOverlay />
      <SetupPopup />
      <DevicePicker />
      <Toaster />
    </>
  );
}
