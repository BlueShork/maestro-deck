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
  onOpenSettings: () => void;
}

export function Toolbar({ onRun, onRunAll, onStop, onOpenSettings }: ToolbarProps) {
  const chatOpen = useChatStore((s) => s.isOpen);
  const toggleChat = useChatStore((s) => s.toggle);
  const inspectEnabled = useInspectorStore((s) => s.enabled);
  const inspectLoading = useInspectorStore((s) => s.loading);
  const toggleInspect = useInspectorStore((s) => s.toggle);
  const running = useRunStore((s) => s.running);
  const fps = useStreamStore((s) => s.fps);
  const showFps = useSettingsStore((s) => s.showFps);
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const panels = usePanelsStore((s) => s.visible);
  const togglePanel = usePanelsStore((s) => s.toggle);
  const showAllPanels = usePanelsStore((s) => s.showAll);

  return (
    <TooltipProvider delayDuration={200}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-auto text-foreground" />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <span className="text-xs text-muted-foreground">v{__APP_VERSION__}</span>
        </div>

        <div className="flex items-center gap-1">
          {showFps ? (
            <span className="mr-2 rounded border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {fps} fps
            </span>
          ) : null}

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

          {running ? (
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
              {VIEW_ENTRIES.map(({ id, label }) => {
                const visible = panels[id];
                return (
                  <DropdownMenuItem
                    key={id}
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
              })}
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
              <Button size="icon" variant="ghost" onClick={onOpenSettings}>
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
