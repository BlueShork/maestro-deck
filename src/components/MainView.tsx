// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { writeTextFile } from "@tauri-apps/plugin-fs";
import { tempDir } from "@tauri-apps/api/path";
import { Suspense, lazy, useCallback, useMemo } from "react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { DeviceView } from "@/components/DeviceView";
import { FlowEditor } from "@/components/FlowEditor";
import { InspectorPanel } from "@/components/InspectorPanel";
const MetricsPanel = lazy(() =>
  import("@/components/MetricsPanel").then((m) => ({ default: m.MetricsPanel })),
);
import { PanelShell } from "@/components/PanelShell";
import { RunConsole } from "@/components/RunConsole";
import { Toolbar } from "@/components/Toolbar";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ipc } from "@/lib/ipc";
import { parseFlow } from "@/lib/flowAst";
import { buildPartialFlow } from "@/lib/partialFlow";
import { useShortcuts } from "@/lib/keyboard";
import { useChatStore } from "@/stores/chatStore";
import { useFlowStore } from "@/stores/flowStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { usePanelsStore } from "@/stores/panelsStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

/**
 * The primary workspace screen — toolbar plus the resizable panel layout
 * (workspace, inspector, device, editor, console, metrics, chat). Owns the
 * run callbacks and keyboard shortcuts, which only make sense here. Rendered
 * at the `/` route; navigating to `/settings` swaps it out for the full
 * settings page. App-wide effects (runner listeners, theme, metrics) live in
 * `App` so they survive that route change.
 */
export function MainView() {
  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const toggleInspect = useInspectorStore((s) => s.toggle);
  const appendLog = useRunStore((s) => s.appendLog);
  const initSteps = useRunStore((s) => s.initSteps);
  const resetSteps = useRunStore((s) => s.resetSteps);
  const setRunning = useRunStore((s) => s.setRunning);
  const setStarting = useRunStore((s) => s.setStarting);
  const startFailed = useRunStore((s) => s.startFailed);
  const runningPid = useRunStore((s) => s.pid);

  const streamEnabled = useSettingsStore((s) => s.streamEnabled);
  const panels = usePanelsStore((s) => s.visible);
  const chatOpen = useChatStore((s) => s.isOpen);

  // `defaultSize` values within a PanelGroup must sum to 100 — react-
  // resizable-panels warns and normalizes otherwise. Since any panel
  // can be hidden, we compute the fill-sizes dynamically per siblings
  // count so the totals always balance regardless of visibility.
  const WORKSPACE_SIZE = 15;
  const INSPECTOR_SIZE = 18;
  const CHAT_SIZE = 28;
  const mainSize =
    100 -
    (panels.workspace ? WORKSPACE_SIZE : 0) -
    (panels.inspector ? INSPECTOR_SIZE : 0) -
    (chatOpen ? CHAT_SIZE : 0);

  // The bottom row (console / metrics) opens at its minimum height so the
  // editor + device get the most room; the user can drag it taller and the
  // size persists. `BOTTOM_MIN` must match the `main-bottom` Panel's `minSize`.
  const BOTTOM_MIN = 10;
  const bottomVisible = panels.console || panels.metrics;
  const mainTopSize = bottomVisible ? 100 - BOTTOM_MIN : 100;
  const mainBottomSize = 100 - mainTopSize;

  const onRun = useCallback(async () => {
    const { running, starting } = useRunStore.getState();
    if (running || starting) return;
    const { content, filePath } = useFlowStore.getState();
    let path = filePath;
    setStarting();
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
      useRunStore.getState().setRunTarget({ path, kind: "flow" });
      const pid = await ipc.runFlow(path, useSettingsStore.getState().appId);
      setRunning(pid);
      appendLog("system", `[runner started pid ${pid} · ${path}]`);
    } catch (err) {
      startFailed();
      toast.error("Run failed", err instanceof Error ? err.message : String(err));
    }
  }, [setRunning, setStarting, startFailed, appendLog, initSteps, resetSteps]);

  const onRunAll = useCallback(async () => {
    const folder = useWorkspaceStore.getState().folderPath;
    if (!folder) return;
    const { running, starting } = useRunStore.getState();
    if (running || starting) return;
    setStarting();
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
      useRunStore.getState().setRunTarget({ path: folder, kind: "all" });
      const pid = await ipc.runFlow(folder, useSettingsStore.getState().appId);
      setRunning(pid);
      appendLog("system", `[runner started pid ${pid} · all flows in ${folder}]`);
    } catch (err) {
      startFailed();
      toast.error("Run all failed", err instanceof Error ? err.message : String(err));
    }
  }, [setRunning, setStarting, startFailed, appendLog, initSteps, resetSteps]);

  const onRunFrom = useCallback(
    async (line: number) => {
      const { content } = useFlowStore.getState();
      const partial = buildPartialFlow(content, line);
      if (!partial) return;
      const { running, starting } = useRunStore.getState();
      if (running || starting) return;
      setStarting();
      try {
        const dir = await tempDir();
        const tempPath = `${dir.replace(/\/$/, "")}/maestro-deck-flow.yaml`;
        await writeTextFile(tempPath, partial.content);
        const truncatedAst = parseFlow(partial.content);
        const remappedSteps = truncatedAst.steps.map((s) => ({
          ...s,
          line: partial.lineMap.get(s.line) ?? s.line,
        }));
        resetSteps();
        initSteps(remappedSteps);
        useRunStore.getState().setRunTarget({ path: tempPath, kind: "flow" });
        const pid = await ipc.runFlow(tempPath, useSettingsStore.getState().appId);
        setRunning(pid);
        appendLog(
          "system",
          `[runner started pid ${pid} · from line ${partial.firstStepOriginalLine}]`,
        );
      } catch (err) {
        startFailed();
        toast.error("Run from here failed", err instanceof Error ? err.message : String(err));
      }
    },
    [setRunning, setStarting, startFailed, appendLog, initSteps, resetSteps],
  );

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
            <PanelGroup direction="vertical" autoSaveId="maestro-deck.layout.main.v2">
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
                        <FlowEditor onRunFrom={onRunFrom} />
                      </PanelShell>
                    </Panel>
                  ) : null}
                </PanelGroup>
              </Panel>

              {panels.console || panels.metrics ? (
                <>
                  <PanelResizeHandle className={RESIZE_HANDLE_V} />
                  <Panel
                    id="main-bottom"
                    order={2}
                    defaultSize={mainBottomSize}
                    minSize={BOTTOM_MIN}
                  >
                    <PanelGroup direction="horizontal" autoSaveId="maestro-deck.layout.bottom">
                      {panels.console ? (
                        <Panel
                          id="console"
                          order={1}
                          defaultSize={panels.metrics ? 70 : 100}
                          minSize={20}
                        >
                          <PanelShell id="console">
                            <RunConsole onRun={() => void onRun()} onStop={() => void onStop()} />
                          </PanelShell>
                        </Panel>
                      ) : null}

                      {panels.metrics ? (
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

          {chatOpen ? (
            <>
              <PanelResizeHandle className={RESIZE_HANDLE_H} />
              <Panel id="chat" order={4} defaultSize={CHAT_SIZE} minSize={20} maxSize={50}>
                <ChatPanel />
              </Panel>
            </>
          ) : null}
        </PanelGroup>
      </div>
    </div>
  );
}

/** Hover-only thin line between horizontally-stacked panels. */
const RESIZE_HANDLE_H =
  "w-[3px] bg-border/0 transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60 data-[resize-handle-state=hover]:bg-primary/40";
/** Same, but rotated for vertically-stacked panels. */
const RESIZE_HANDLE_V =
  "h-[3px] bg-border/0 transition-colors hover:bg-primary/40 data-[resize-handle-state=drag]:bg-primary/60 data-[resize-handle-state=hover]:bg-primary/40";
