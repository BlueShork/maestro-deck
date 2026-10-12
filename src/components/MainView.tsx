// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { lazy, Suspense, useEffect, useMemo } from "react";

import { CloudLivePreview } from "@/components/CloudLivePreview";
import { DeviceSelector } from "@/components/DeviceSelector";
import { DeviceView } from "@/components/DeviceView";
import { FarmSessionBar } from "@/components/FarmSessionBar";
import { FlowEditor } from "@/components/FlowEditor";
import { PanelHeader } from "@/components/PanelHeader";
import { useConnectingEntry } from "@/components/devices/useCatalog";
import { PanelShell } from "@/components/PanelShell";
import { RunConsole } from "@/components/RunConsole";
import { ScreenshotReview } from "@/components/ScreenshotReview";
import { Toolbar } from "@/components/Toolbar";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { PluginPanel } from "@/components/plugins/PluginPanel";
import { useAppMenu } from "@/lib/appMenu";
import { runAllFlows, runFromLine, runOpenFlow, stopRun } from "@/lib/runLauncher";
import { IS_MAC, useShortcuts } from "@/lib/keyboard";
import { useChatStore } from "@/stores/chatStore";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { usePanelsStore } from "@/stores/panelsStore";
import { usePluginsStore } from "@/stores/pluginsStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

// Mounted only while the assistant is open; its markdown stack stays out of
// the startup bundle.
const ChatPanel = lazy(() =>
  import("@/components/chat/ChatPanel").then((m) => ({ default: m.ChatPanel })),
);

/**
 * The primary workspace screen — toolbar plus the resizable panel layout
 * (workspace, inspector, device, editor, console, chat). Owns the
 * run callbacks and keyboard shortcuts, which only make sense here. Rendered
 * at the `/` route; navigating to `/settings` swaps it out for the full
 * settings page. App-wide effects (runner listeners, theme, metrics) live in
 * `App` so they survive that route change.
 */
export function MainView() {
  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const toggleInspect = useInspectorStore((s) => s.toggle);

  const streamEnabled = useSettingsStore((s) => s.streamEnabled);
  const panels = usePanelsStore((s) => s.visible);
  const chatOpen = useChatStore((s) => s.isOpen);
  const pluginPanel = usePluginsStore((s) => s.openPanel);
  const rightOpen = chatOpen || pluginPanel !== null;
  useEffect(() => {
    void usePluginsStore.getState().refreshInstalled();
  }, []);
  const cloudJob = useRunStore((s) => s.cloud);
  // Every cloud fleet uploads frames: the emulator runner, the Mac worker and
  // the device-farm worker all write the same live.jpg.
  const cloudTarget = useCloudTargetStore((s) => s.target);
  const cloudLive = cloudJob && cloudTarget ? { ...cloudJob, platform: cloudTarget } : null;

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
    (rightOpen ? CHAT_SIZE : 0);

  // The bottom row (console) opens at its minimum height so the
  // editor + device get the most room; the user can drag it taller and the
  // size persists. `BOTTOM_MIN` must match the `main-bottom` Panel's `minSize`.
  const BOTTOM_MIN = 10;
  const bottomVisible = panels.console;
  const mainTopSize = bottomVisible ? 100 - BOTTOM_MIN : 100;
  const mainBottomSize = 100 - mainTopSize;

  const onRun = runOpenFlow;
  const onRunAll = runAllFlows;
  const onRunFrom = runFromLine;
  const onStop = stopRun;

  const shortcuts = useMemo(
    () => [
      // On macOS the menu bar owns ⌘R / ⌘S (useAppMenu); binding them here
      // too would fire twice.
      ...(IS_MAC
        ? []
        : [
            { key: "r", mod: true, handler: () => void onRun() },
            {
              key: "s",
              mod: true,
              handler: () =>
                window.dispatchEvent(new CustomEvent("flow:command", { detail: "save" })),
              allowInInput: true,
            },
          ]),
      { key: inspectKey, handler: () => void toggleInspect() },
      {
        key: "d",
        mod: true,
        shift: true,
        handler: () => useDevicePickerStore.getState().setOpen(true),
        // The editor holds focus from startup; a modifier chord never types.
        allowInInput: true,
      },
    ],
    [onRun, toggleInspect, inspectKey],
  );
  useShortcuts(shortcuts);
  useAppMenu({
    onRun: () => void onRun(),
    onRunAll: () => void onRunAll(),
    onStop: () => void onStop(),
  });

  return (
    <>
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
                <Panel id="workspace" order={1} defaultSize={WORKSPACE_SIZE} minSize={8}>
                  <PanelShell id="workspace">
                    <WorkspaceTree />
                  </PanelShell>
                </Panel>
                <PanelResizeHandle className={RESIZE_HANDLE_H} />
              </>
            ) : null}

            {panels.inspector ? (
              <>
                <Panel id="inspector" order={2} defaultSize={INSPECTOR_SIZE} minSize={10}>
                  <PanelShell id="inspector">
                    <DeviceSelector />
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
                          <PanelShell id="device">
                            <DevicePanelHeader />
                            {/* Outside the canvas container and its pointer
                                handlers, so these buttons never turn into
                                taps on the phone. */}
                            <FarmSessionBar />
                            <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center p-4">
                              <DeviceView />
                              {cloudLive ? (
                                <CloudLivePreview
                                  jobId={cloudLive.jobId}
                                  status={cloudLive.status}
                                  platform={cloudLive.platform}
                                />
                              ) : null}
                            </div>
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
                      >
                        <PanelShell id="editor">
                          <FlowEditor onRunFrom={onRunFrom} />
                        </PanelShell>
                      </Panel>
                    ) : null}
                  </PanelGroup>
                </Panel>

                {panels.console ? (
                  <>
                    <PanelResizeHandle className={RESIZE_HANDLE_V} />
                    <Panel
                      id="main-bottom"
                      order={2}
                      defaultSize={mainBottomSize}
                      minSize={BOTTOM_MIN}
                    >
                      <PanelShell id="console">
                        <RunConsole />
                      </PanelShell>
                    </Panel>
                  </>
                ) : null}
              </PanelGroup>
            </Panel>

            {rightOpen ? (
              <>
                <PanelResizeHandle className={RESIZE_HANDLE_H} />
                <Panel id="chat" order={4} defaultSize={CHAT_SIZE} minSize={20} maxSize={50}>
                  {chatOpen ? (
                    <Suspense fallback={null}>
                      <ChatPanel />
                    </Suspense>
                  ) : (
                    <PluginPanel />
                  )}
                </Panel>
              </>
            ) : null}
          </PanelGroup>
        </div>
      </div>
      <ScreenshotReview />
    </>
  );
}

/** Device panel header: the connected device's name next to the label, so
 *  the mirror lines up with the other panels' header row. */
function DevicePanelHeader() {
  const current = useDeviceStore((s) => s.current);
  const connecting = useConnectingEntry();
  return (
    <PanelHeader
      title="Device"
      meta={
        connecting && !current ? (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-foreground">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse bg-brand" />
            <span className="truncate">Connecting · {connecting.name}</span>
          </span>
        ) : current ? (
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-foreground">
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 bg-success" />
            <span className="truncate">{current.model}</span>
          </span>
        ) : (
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            Not connected
          </span>
        )
      }
    />
  );
}

/** The hairline between horizontally-stacked panels is the handle itself:
 *  1px of --border that turns orange under the cursor or while dragging,
 *  with a wider invisible hit area so it stays easy to grab. */
const RESIZE_HANDLE_H =
  "relative w-px bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-[''] data-[resize-handle-state=hover]:bg-brand data-[resize-handle-state=drag]:bg-brand";
/** Same, rotated for vertically-stacked panels. */
const RESIZE_HANDLE_V =
  "relative h-px bg-border transition-colors after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-[''] data-[resize-handle-state=hover]:bg-brand data-[resize-handle-state=drag]:bg-brand";
