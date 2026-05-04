import { writeTextFile } from "@tauri-apps/plugin-fs";
import { listen } from "@tauri-apps/api/event";
import { tempDir } from "@tauri-apps/api/path";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { DeviceView } from "@/components/DeviceView";
import { FlowEditor } from "@/components/FlowEditor";
import { InspectorPanel } from "@/components/InspectorPanel";
const MetricsPanel = lazy(() =>
  import("@/components/MetricsPanel").then((m) => ({ default: m.MetricsPanel })),
);
import { PanelShell } from "@/components/PanelShell";
import { RunConsole } from "@/components/RunConsole";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toolbar } from "@/components/Toolbar";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { Toaster } from "@/components/ui/Toast";
import { openFlowFile } from "@/lib/flow-io";
import { events, ipc } from "@/lib/ipc";
import { parseFlow } from "@/lib/flowAst";
import { useShortcuts } from "@/lib/keyboard";
import { parseLine as parseRunLine } from "@/lib/runStepParser";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFlowStore } from "@/stores/flowStore";
import { useMetricsStore } from "@/stores/metricsStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { usePanelsStore } from "@/stores/panelsStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { toast, useToastStore } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

export default function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const theme = useSettingsStore((s) => s.theme);
  const toggleInspect = useInspectorStore((s) => s.toggle);
  const markDisconnected = useDeviceStore((s) => s.markDisconnected);
  const appendLog = useRunStore((s) => s.appendLog);
  const initSteps = useRunStore((s) => s.initSteps);
  const applyStepEvent = useRunStore((s) => s.applyEvent);
  const resetSteps = useRunStore((s) => s.resetSteps);
  const setRunning = useRunStore((s) => s.setRunning);
  const setStopped = useRunStore((s) => s.setStopped);
  const runningPid = useRunStore((s) => s.pid);

  // Restore the last opened file from the previous session. The workspace
  // store hydrates synchronously from localStorage, so the path is available
  // on first effect tick.
  useEffect(() => {
    const last = useWorkspaceStore.getState().lastOpenFile;
    if (last) void openFlowFile(last, { silent: true });
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
      events.onRunnerStdout((line) => {
        appendLog("stdout", line);
        const ev = parseRunLine(line);
        if (ev) applyStepEvent(ev);
      }),
      events.onRunnerStderr((line) => appendLog("stderr", line)),
      events.onRunnerExit(({ code }) => {
        const wasStopped = useRunStore.getState().stopRequested;
        appendLog(
          "system",
          wasStopped ? "[runner stopped by user]" : `[runner exited with code ${code}]`,
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
    const unlistenRecovered = listen<{ device_id: string }>(
      "driver-recovered",
      () => {
        if (toastId) {
          useToastStore.getState().dismiss(toastId);
          toastId = null;
        }
      },
    );
    return () => {
      void unlistenRecovering.then((u) => u());
      void unlistenRecovered.then((u) => u());
      if (toastId) {
        useToastStore.getState().dismiss(toastId);
      }
    };
  }, []);

  const panelOpen = useMetricsStore((s) => s.panelOpen);
  const perfEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const panels = usePanelsStore((s) => s.visible);

  // `defaultSize` values within a PanelGroup must sum to 100 — react-
  // resizable-panels warns and normalizes otherwise. Since any panel
  // can be hidden, we compute the fill-sizes dynamically per siblings
  // count so the totals always balance regardless of visibility.
  const WORKSPACE_SIZE = 15;
  const INSPECTOR_SIZE = 18;
  const mainSize =
    100 - (panels.workspace ? WORKSPACE_SIZE : 0) - (panels.inspector ? INSPECTOR_SIZE : 0);

  const bottomVisible = panels.console || (perfEnabled && panelOpen && panels.metrics);
  const mainTopSize = bottomVisible ? 65 : 100;
  const mainBottomSize = 100 - mainTopSize;
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
      resetSteps();
      initSteps(parseFlow(content).steps);
      const pid = await ipc.runFlow(path);
      setRunning(pid);
      appendLog("system", `[runner started pid ${pid} · ${path}]`);
    } catch (err) {
      toast.error("Run failed", err instanceof Error ? err.message : String(err));
    }
  }, [setRunning, appendLog, initSteps, resetSteps]);

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
      const { content: c2 } = useFlowStore.getState();
      resetSteps();
      initSteps(parseFlow(c2).steps);
      const pid = await ipc.runFlow(folder);
      setRunning(pid);
      appendLog("system", `[runner started pid ${pid} · all flows in ${folder}]`);
    } catch (err) {
      toast.error("Run all failed", err instanceof Error ? err.message : String(err));
    }
  }, [setRunning, appendLog, initSteps, resetSteps]);

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
        handler: () => window.dispatchEvent(new CustomEvent("flow:command", { detail: "save" })),
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
      <div className="min-h-0 flex-1">
        <PanelGroup direction="horizontal" autoSaveId="maestro-deck.layout.outer">
          {panels.workspace ? (
            <>
              <Panel
                id="workspace"
                order={1}
                defaultSize={WORKSPACE_SIZE}
                minSize={8}
                className="border-r border-border"
              >
                <PanelShell id="workspace">
                  <WorkspaceTree />
                </PanelShell>
              </Panel>
              <PanelResizeHandle className={RESIZE_HANDLE_H} />
            </>
          ) : null}

          {panels.inspector ? (
            <>
              <Panel
                id="inspector"
                order={2}
                defaultSize={INSPECTOR_SIZE}
                minSize={10}
                className="border-r border-border"
              >
                <PanelShell id="inspector">
                  <DeviceSelector />
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <InspectorPanel />
                  </div>
                </PanelShell>
              </Panel>
              <PanelResizeHandle className={RESIZE_HANDLE_H} />
            </>
          ) : null}

          <Panel id="main" order={3} defaultSize={mainSize} minSize={30}>
            <PanelGroup direction="vertical" autoSaveId="maestro-deck.layout.main">
              <Panel id="main-top" order={1} defaultSize={mainTopSize} minSize={20}>
                <PanelGroup direction="horizontal" autoSaveId="maestro-deck.layout.top">
                  {streamEnabled && panels.device ? (
                    <>
                      <Panel
                        id="device"
                        order={1}
                        // Panels in the same group must have defaultSize
                        // values that sum to 100, otherwise the library
                        // warns and normalizes. Collapse to 100 when the
                        // sibling is hidden so we don't rely on
                        // normalization + avoid the console warning.
                        defaultSize={panels.editor ? 55 : 100}
                        minSize={20}
                      >
                        <PanelShell
                          id="device"
                          className="items-center justify-center bg-muted/40 p-4"
                        >
                          <DeviceView />
                        </PanelShell>
                      </Panel>
                      {panels.editor ? <PanelResizeHandle className={RESIZE_HANDLE_H} /> : null}
                    </>
                  ) : null}

                  {panels.editor ? (
                    <Panel
                      id="editor"
                      order={2}
                      defaultSize={streamEnabled && panels.device ? 45 : 100}
                      minSize={20}
                      className={
                        streamEnabled && panels.device ? "border-l border-border" : undefined
                      }
                    >
                      <PanelShell id="editor">
                        <FlowEditor />
                      </PanelShell>
                    </Panel>
                  ) : null}
                </PanelGroup>
              </Panel>

              {panels.console || (perfEnabled && panelOpen && panels.metrics) ? (
                <>
                  <PanelResizeHandle className={RESIZE_HANDLE_V} />
                  <Panel id="main-bottom" order={2} defaultSize={mainBottomSize} minSize={10}>
                    <PanelGroup direction="horizontal" autoSaveId="maestro-deck.layout.bottom">
                      {panels.console ? (
                        <Panel
                          id="console"
                          order={1}
                          defaultSize={perfEnabled && panelOpen && panels.metrics ? 70 : 100}
                          minSize={20}
                        >
                          <PanelShell id="console">
                            <RunConsole onRun={() => void onRun()} onStop={() => void onStop()} />
                          </PanelShell>
                        </Panel>
                      ) : null}

                      {perfEnabled && panelOpen && panels.metrics ? (
                        <>
                          {panels.console ? (
                            <PanelResizeHandle className={RESIZE_HANDLE_H} />
                          ) : null}
                          <Panel
                            id="metrics"
                            order={2}
                            defaultSize={panels.console ? 30 : 100}
                            minSize={15}
                          >
                            <PanelShell id="metrics">
                              <Suspense fallback={null}>
                                <MetricsPanel />
                              </Suspense>
                            </PanelShell>
                          </Panel>
                        </>
                      ) : null}
                    </PanelGroup>
                  </Panel>
                </>
              ) : null}
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster />
    </div>
  );
}

/** Hover-only thin line between horizontally-stacked panels. */
const RESIZE_HANDLE_H =
  "w-[3px] bg-border/0 transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60 data-[resize-handle-state=hover]:bg-primary/40";
/** Same, but rotated for vertically-stacked panels. */
const RESIZE_HANDLE_V =
  "h-[3px] bg-border/0 transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60 data-[resize-handle-state=hover]:bg-primary/40";
