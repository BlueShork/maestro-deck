// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  BookOpen,
  Check,
  LayoutPanelLeft,
  ListChecks,
  Loader2,
  MousePointer2,
  Play,
  Settings,
  Sparkles,
  Square,
} from "lucide-react";

import { openUrl } from "@tauri-apps/plugin-opener";
import { useNavigate } from "react-router-dom";

import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Separator } from "@/components/ui/Separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { useInspectorStore } from "@/stores/inspectorStore";
import { usePanelsStore, type PanelId } from "@/stores/panelsStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { useUpdateStore } from "@/stores/updateStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/** Menu entries for the View dropdown. Order = on-screen left→right,
 *  top→bottom, matching the panel layout in App.tsx. */
const VIEW_ENTRIES: Array<{ id: PanelId; label: string }> = [
  { id: "workspace", label: "Workspace" },
  { id: "inspector", label: "Inspector" },
  { id: "device", label: "Device" },
  { id: "editor", label: "Editor" },
  { id: "console", label: "Run console" },
  { id: "metrics", label: "Performance" },
];

interface ToolbarProps {
  onRun: () => void;
  onRunAll: () => void;
  onStop: () => void;
}

/** Isolated so the periodic fps updates (4 Hz while a device streams)
 *  re-render only this tiny badge instead of the whole Toolbar. */
function FpsBadge() {
  const fps = useStreamStore((s) => s.fps);
  const showFps = useSettingsStore((s) => s.showFps);
  if (!showFps) return null;
  return (
    <span className="mr-2 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {fps} fps
    </span>
  );
}

/** Subscribes to its own panel's flag only, so toggling one panel
 *  re-renders just this menu item — not the Toolbar. */
function PanelMenuItem({ id, label }: { id: PanelId; label: string }) {
  const visible = usePanelsStore((s) => s.visible[id]);
  const togglePanel = usePanelsStore((s) => s.toggle);
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        // Keep the menu open so users can toggle multiple
        // panels in one pass.
        e.preventDefault();
        togglePanel(id);
      }}
      className="justify-between gap-6"
    >
      <span>{label}</span>
      <Check className={cn("h-3.5 w-3.5", visible ? "opacity-100" : "opacity-0")} />
    </DropdownMenuItem>
  );
}

export function Toolbar({ onRun, onRunAll, onStop }: ToolbarProps) {
  const navigate = useNavigate();
  const chatOpen = useChatStore((s) => s.isOpen);
  const toggleChat = useChatStore((s) => s.toggle);
  const inspectEnabled = useInspectorStore((s) => s.enabled);
  const inspectLoading = useInspectorStore((s) => s.loading);
  const toggleInspect = useInspectorStore((s) => s.toggle);
  const running = useRunStore((s) => s.running);
  const starting = useRunStore((s) => s.starting);
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const showAllPanels = usePanelsStore((s) => s.showAll);
  const updatePhase = useUpdateStore((s) => s.phase);
  const checkUpdate = useUpdateStore((s) => s.check);

  return (
    <TooltipProvider delayDuration={200}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-auto text-foreground" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void checkUpdate()}
                disabled={updatePhase === "checking"}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60"
              >
                {updatePhase === "checking" ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    checking…
                  </span>
                ) : (
                  `v${__APP_VERSION__}`
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent>Check for updates</TooltipContent>
          </Tooltip>
        </div>

        <div className="flex items-center gap-1">
          <FpsBadge />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={inspectEnabled ? "default" : "ghost"}
                onClick={() => void toggleInspect()}
                disabled={inspectLoading && !inspectEnabled}
                aria-pressed={inspectEnabled}
                aria-busy={inspectLoading}
                aria-label="Toggle inspect mode"
              >
                {inspectLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MousePointer2 className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {inspectLoading
                ? inspectEnabled
                  ? "Refreshing hierarchy…"
                  : "Dumping hierarchy…"
                : "Inspect (I)"}
            </TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-5" />

          {starting ? (
            <Button size="sm" variant="destructive" disabled className="gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Starting…
            </Button>
          ) : running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="destructive" onClick={onStop} className="gap-1.5">
                  <Square className="h-3.5 w-3.5" fill="currentColor" />
                  Stop
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop flow</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" variant="default" onClick={onRun} className={cn("gap-1.5")}>
                    <Play className="h-3.5 w-3.5" fill="currentColor" />
                    Run
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Run flow (Cmd/Ctrl+R)</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onRunAll}
                    disabled={!folderPath}
                    className="gap-1.5"
                  >
                    <ListChecks className="h-3.5 w-3.5" />
                    Run all
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {folderPath ? "Run every flow in the workspace" : "Open a folder to enable"}
                </TooltipContent>
              </Tooltip>
            </>
          )}

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label="Toggle panels">
                    <LayoutPanelLeft className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>View</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Panels</DropdownMenuLabel>
              {VIEW_ENTRIES.map(({ id, label }) => (
                <PanelMenuItem key={id} id={id} label={label} />
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => showAllPanels()}>Show all</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={chatOpen ? "secondary" : "ghost"}
                onClick={toggleChat}
                aria-label="Toggle AI assistant"
              >
                <Sparkles className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>AI assistant</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void openUrl("https://www.maestrodeck.cloud/docs")}
                aria-label="Open documentation"
              >
                <BookOpen className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Documentation</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={() => navigate("/settings")}>
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
