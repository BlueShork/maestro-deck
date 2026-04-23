import { writeTextFile } from "@tauri-apps/plugin-fs";
import { tempDir } from "@tauri-apps/api/path";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DeviceSelector } from "@/components/DeviceSelector";
import { DeviceView } from "@/components/DeviceView";
import { FlowEditor } from "@/components/FlowEditor";
import { InspectorPanel } from "@/components/InspectorPanel";
import { RunConsole } from "@/components/RunConsole";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Toolbar } from "@/components/Toolbar";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { Toaster } from "@/components/ui/Toast";
import { openFlowFile } from "@/lib/flow-io";
import { events, ipc } from "@/lib/ipc";
import { useShortcuts } from "@/lib/keyboard";
import { applyTheme, watchSystemTheme } from "@/lib/theme";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFlowStore } from "@/stores/flowStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
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
    ]).then((fns) => {
      if (cancelled) fns.forEach((fn) => fn());
      else cleanups = fns;
    });
    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [appendLog, setStopped, markDisconnected]);

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
            <section className="flex min-w-0 flex-1 items-center justify-center bg-muted/40 p-4">
              <DeviceView />
            </section>
            <section className="flex w-[45%] min-w-0 flex-col border-l border-border">
              <FlowEditor />
            </section>
          </div>
          <RunConsole onRun={() => void onRun()} onStop={() => void onStop()} />
        </main>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <Toaster />
    </div>
  );
}
