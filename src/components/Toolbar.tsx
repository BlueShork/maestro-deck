import { ListChecks, MousePointer2, Play, Settings, Square } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Separator } from "@/components/ui/Separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/Tooltip";
import { cn } from "@/lib/utils";
import { useInspectorStore } from "@/stores/inspectorStore";
import { useRunStore } from "@/stores/runStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useStreamStore } from "@/stores/streamStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

interface ToolbarProps {
  onRun: () => void;
  onRunAll: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({ onRun, onRunAll, onStop, onOpenSettings }: ToolbarProps) {
  const inspectEnabled = useInspectorStore((s) => s.enabled);
  const toggleInspect = useInspectorStore((s) => s.toggle);
  const running = useRunStore((s) => s.running);
  const fps = useStreamStore((s) => s.fps);
  const showFps = useSettingsStore((s) => s.showFps);
  const folderPath = useWorkspaceStore((s) => s.folderPath);

  return (
    <TooltipProvider delayDuration={200}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background/80 px-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-xs font-bold text-primary">
            M
          </div>
          <div className="text-sm font-semibold tracking-tight">
            Maestro Deck
          </div>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <span className="text-xs text-muted-foreground">v0.1.0</span>
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
                aria-pressed={inspectEnabled}
                aria-label="Toggle inspect mode"
              >
                <MousePointer2 className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Inspect (I)</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="mx-1 h-5" />

          {running ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={onStop}
                  className="gap-1.5"
                >
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
                  <Button
                    size="sm"
                    variant="default"
                    onClick={onRun}
                    className={cn("gap-1.5")}
                  >
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
                  {folderPath
                    ? "Run every flow in the workspace"
                    : "Open a folder to enable"}
                </TooltipContent>
              </Tooltip>
            </>
          )}

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
