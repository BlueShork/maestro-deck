import { writeTextFile } from "@tauri-apps/plugin-fs";
import { tempDir } from "@tauri-apps/api/path";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { DeviceView } from "@/components/DeviceView";
import { FlowEditor } from "@/components/FlowEditor";
import { InspectorPanel } from "@/components/InspectorPanel";
const MetricsPanel = lazy(() =>
  import("@/components/MetricsPanel").then((m) => ({ default: m.MetricsPanel })),
);
import { RunConsole } from "@/components/RunConsole";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toolbar } from "@/components/Toolbar";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { Toaster } from "@/components/ui/Toast";
import { openFlowFile } from "@/lib/flow-io";
import { events, ipc } from "@/lib/ipc";
import { useShortcuts } from "@/lib/keyboard";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFlowStore } from "@/stores/flowStore";
import { useMetricsStore } from "@/stores/metricsStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const theme = useSettingsStore((s) => s.theme);
  const toggleInspect = useInspectorStore((s) => s.toggle);
  const markDisconnected = useDeviceStore((s) => s.markDisconnected);
  const appendLog = useRunStore((s) => s.appendLog);
  const setRunning = useRunStore((s) => s.setRunning);
  const setStopped = useRunStore((s) => s.setStopped);
  const runningPid = useRunStore((s) => s.pid);

  // Restore the last opened file from the previous session. The workspace
  // store hydrates synchronously from localStorage, so the path is available
  // on first effect tick.
  useEffect(() => {
    const last = useWorkspaceStore.getState().lastOpenFile;
    if (last) void openFlowFile(last, { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const appendSample = useMetricsStore((s) => s.appendSample);
  const onTargetChanged = useMetricsStore((s) => s.onTargetChanged);
  const setStoppedReason = useMetricsStore((s) => s.setStoppedReason);

  useEffect(() => {
    let cleanups: Array<() => void> = [];
    let cancelled = false;
    Promise.all([
      events.onRunnerStdout((line) => appendLog("stdout", line)),
      events.onRunnerStderr((line) => appendLog("stderr", line)),
      events.onRunnerExit(({ code }) => {
        const wasStopped = useRunStore.getState().stopRequested;
        appendLog(
          "system",
          wasStopped
            ? "[runner stopped by user]"
            : `[runner exited with code ${code}]`,
        );
        setStopped(code);
        if (wasStopped) toast.success("Flow stopped");
        else if (code === 0) toast.success("Flow completed");
        else toast.error("Flow failed", `exit code ${code}`);
      }),
      events.onDeviceDisconnected(() => markDisconnected()),
      events.onMetricsSample((p) =>
        appendSample({
          ts: p.ts,
          cpuPct: p.cpu_pct,
          memMb: p.mem_mb,
          fps: p.fps,
          jankPct: p.jank_pct,
          netRxKbps: p.net_rx_kbps,
          netTxKbps: p.net_tx_kbps,
        }),
      ),
      events.onMetricsTargetChanged((p) => onTargetChanged(p.to)),
      events.onMetricsStopped((p) =>
        setStoppedReason(p.reason === "user" ? null : p.reason),
      ),
    ]).then((fns) => {
      if (cancelled) fns.forEach((fn) => fn());
      else cleanups = fns;
    });
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [appendLog, setStopped, markDisconnected, appendSample, onTargetChanged, setStoppedReason]);

  const panelOpen = useMetricsStore((s) => s.panelOpen);
  const perfEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const deviceConnected = useDeviceStore((s) => Boolean(s.current));

  useEffect(() => {
    if (!perfEnabled || !panelOpen || !deviceConnected) {
      void ipc.stopMetrics().catch(() => {});
      return;
    }
    void ipc.startMetrics().catch((err) => {
      toast.error(
        "Performance monitoring failed to start",
        err instanceof Error ? err.message : String(err),
      );
    });
    return () => {
      void ipc.stopMetrics().catch(() => {});
    };
  }, [perfEnabled, panelOpen, deviceConnected]);

  const onRun = useCallback(async () => {
    const { content, filePath } = useFlowStore.getState();
    let path = filePath;
    try {
      if (!path) {
        const dir = await tempDir();
        path = `${dir.replace(/\/$/, "")}/maestro-deck-flow.yaml`;
        await writeTextFile(path, content);
      } else {
        await writeTextFile(path, content);
      }
      const pid = await ipc.runFlow(path);
      setRunning(pid);
      appendLog("system", `[runner started pid ${pid} · ${path}]`);
    } catch (err) {
      toast.error("Run failed", err instanceof Error ? err.message : String(err));
    }
  }, [setRunning, appendLog]);

  const onRunAll = useCallback(async () => {
    const folder = useWorkspaceStore.getState().folderPath;
    if (!folder) return;
    try {
      // Persist any unsaved edits to the current file so they're part of the run.
      const { content, filePath, dirty } = useFlowStore.getState();
      if (dirty && filePath) {
        await writeTextFile(filePath, content);
        useFlowStore.getState().saved(filePath);
      }
      const pid = await ipc.runFlow(folder);
      setRunning(pid);
      appendLog("system", `[runner started pid ${pid} · all flows in ${folder}]`);
    } catch (err) {
      toast.error("Run all failed", err instanceof Error ? err.message : String(err));
    }
  }, [setRunning, appendLog]);

  const onStop = useCallback(async () => {
    if (runningPid === null) return;
    useRunStore.getState().requestStop();
    try {
      await ipc.stopFlow(runningPid);
    } catch (err) {
      toast.error("Stop failed", err instanceof Error ? err.message : String(err));
    }
  }, [runningPid]);

  const shortcuts = useMemo(
    () => [
      { key: "r", mod: true, handler: () => void onRun() },
      {
        key: "s",
        mod: true,
        handler: () =>
          window.dispatchEvent(
            new CustomEvent("flow:command", { detail: "save" }),
          ),
        allowInInput: true,
      },
      { key: inspectKey, handler: () => void toggleInspect() },
    ],
    [onRun, toggleInspect, inspectKey],
  );
  useShortcuts(shortcuts);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Toolbar
        onRun={() => void onRun()}
        onRunAll={() => void onRunAll()}
        onStop={() => void onStop()}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border">
          <WorkspaceTree />
        </aside>
        <aside className="flex w-72 shrink-0 flex-col border-r border-border">
          <DeviceSelector />
          <div className="min-h-0 flex-1 overflow-hidden">
            <InspectorPanel />
          </div>
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {streamEnabled ? (
              <section className="flex min-w-0 flex-1 items-center justify-center bg-muted/40 p-4">
                <DeviceView />
              </section>
            ) : null}
            <section
              className={cn(
                "flex min-w-0 flex-col",
                streamEnabled
                  ? "w-[45%] border-l border-border"
                  : "flex-1",
              )}
            >
              <FlowEditor />
            </section>
          </div>
          <div className="flex min-h-0">
            <div className="flex min-h-0 flex-1 flex-col">
              <RunConsole onRun={() => void onRun()} onStop={() => void onStop()} />
            </div>
            {perfEnabled && panelOpen && (
              <Suspense fallback={null}>
                <MetricsPanel />
              </Suspense>
            )}
          </div>
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster />
    </div>
  );
}
