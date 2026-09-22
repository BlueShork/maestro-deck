// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  BookOpen,
  Check,
  Images,
  LayoutPanelLeft,
  ListChecks,
  Loader2,
  MousePointer2,
  Play,
  Settings,
  Cloud,
  Sparkle,
  Sparkles,
  Square,
  User,
  Zap,
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
import { tierLabel } from "@/lib/cloudAuth";
import { CLOUD_ARTIFACTS, CLOUD_TARGET_LABELS } from "@/lib/cloudRunner";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { selectSetupChip, useEnvStore } from "@/stores/envStore";
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

/**
 * Current Maestro Deck Cloud plan, always on screen so the free tier stays
 * visible without nagging: it's a status pill, not a prompt. Signed out it
 * reads "Free Tier"; signed in it shows the live pack. Either way it opens
 * the account page.
 */
function PackBadge() {
  const navigate = useNavigate();
  const user = useCloudAuthStore((s) => s.user);
  const billing = useCloudAuthStore((s) => s.billing);

  // Signed in but the balance hasn't arrived: show the pill in a resting
  // state rather than briefly claiming the user is on the free tier.
  const pending = Boolean(user) && !billing;
  const paid = Boolean(billing) && billing?.tier !== "free";
  const label = !user
    ? "Free Tier"
    : pending
      ? "Plan"
      : (billing?.currentPack?.displayName ?? tierLabel(billing?.tier ?? "free"));
  const Icon = paid ? Zap : Sparkle;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => navigate("/account")}
          aria-label={user ? `Plan: ${label}` : "Sign in to Maestro Deck Cloud"}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            paid
              ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
              : "border-border bg-muted/40 text-muted-foreground hover:text-foreground",
            pending && "opacity-70",
          )}
        >
          <Icon className="h-3 w-3" />
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {user ? "Your Maestro Deck Cloud plan" : "Sign in to Maestro Deck Cloud"}
      </TooltipContent>
    </Tooltip>
  );
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
  const cloudRun = useRunStore((s) => s.cloud);
  const cloudTarget = useCloudTargetStore((s) => s.target);
  // Per platform: iOS installs a zipped .app, Android an .apk. Reading the
  // apk field for an iOS target would keep Run disabled with a build chosen.
  const cloudApk = useWorkspaceStore((s) =>
    cloudTarget === "ios" ? s.cloudIosAppPath : s.cloudApkPath,
  );
  const folderPath = useWorkspaceStore((s) => s.folderPath);
  const showAllPanels = usePanelsStore((s) => s.showAll);
  const updatePhase = useUpdateStore((s) => s.phase);
  const checkUpdate = useUpdateStore((s) => s.check);
  const cloudUser = useCloudAuthStore((s) => s.user);
  const setupChip = useEnvStore(selectSetupChip);
  // A cloud run uploads the flow and needs nothing installed here, so the
  // local toolchain must never gate it.
  const localToolsMissing = useEnvStore((s) => s.minimalOk === false);

  return (
    <TooltipProvider delayDuration={200}>
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-background px-3">
        <div className="flex items-center gap-2">
          <Logo className="h-7 w-auto text-foreground" />
          <PackBadge />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void checkUpdate()}
                disabled={updatePhase === "checking"}
                className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

          {/* Beside Run, because that is where someone reaches when nothing
              happens. Clicking opens the setup panel with the detail. */}
          {setupChip ? (
            <button
              type="button"
              onClick={() => useEnvStore.getState().setCollapsed(false)}
              className={cn(
                "mr-1 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
                setupChip.state === "failed"
                  ? "border-destructive/40 bg-destructive/10 text-destructive-foreground"
                  : "border-border text-muted-foreground hover:bg-accent/40",
              )}
            >
              {setupChip.state === "installing" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {setupChip.text}
            </button>
          ) : null}

          <div data-tour="run-controls" className="flex items-center gap-1">
            {starting ? (
              <Button size="default" variant="destructive" disabled>
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting…
              </Button>
            ) : running ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="default" variant="destructive" onClick={onStop}>
                    <Square className="h-4 w-4" fill="currentColor" />
                    {cloudRun ? "Stop watching" : "Stop"}
                  </Button>
                </TooltipTrigger>
                {/* The cloud has no cancel endpoint and the run is already
                    paid for, so this only detaches — say so rather than
                    implying the job dies with the click. */}
                <TooltipContent>
                  {cloudRun ? "Stop watching — the run continues in the cloud" : "Stop flow"}
                </TooltipContent>
              </Tooltip>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* The button names its destination. Running in the cloud
                        costs a run and cannot be cancelled, so the difference
                        has to be visible before the click, not after. */}
                    <Button
                      size="default"
                      variant="default"
                      onClick={onRun}
                      disabled={cloudTarget !== null ? !cloudApk : localToolsMissing}
                    >
                      {cloudTarget ? (
                        <Cloud className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" fill="currentColor" />
                      )}
                      {cloudTarget ? "Run in cloud" : "Run"}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {!cloudTarget
                      ? localToolsMissing
                        ? (setupChip?.text ?? "Setting up the tools needed to run locally")
                        : "Run flow (Cmd/Ctrl+R)"
                      : !cloudApk
                        ? `${CLOUD_ARTIFACTS[cloudTarget].prompt}, under Cloud in the device panel`
                        : `Runs on ${CLOUD_TARGET_LABELS[cloudTarget]} — spends 1 run once it starts, and cannot be cancelled`}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="default"
                      variant="outline"
                      onClick={onRunAll}
                      disabled={!folderPath || cloudTarget !== null}
                    >
                      <ListChecks className="h-4 w-4" />
                      Run all
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {cloudTarget
                      ? "Run all is local-only for now — clear the cloud target to use it"
                      : folderPath
                        ? "Run every flow in the workspace"
                        : "Open a folder to enable"}
                  </TooltipContent>
                </Tooltip>
              </>
            )}
          </div>

          {/* Non-modal: modal mode inert-marks the whole app (canvas, editor)
              on open/close — visible jank. See ModelPicker for details. */}
          <DropdownMenu modal={false}>
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
                data-tour="chat-toggle"
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
              <Button
                data-tour="image-bank"
                size="icon"
                variant="ghost"
                onClick={() => navigate("/image-bank")}
                aria-label="Open image bank"
              >
                <Images className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Image bank</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant={cloudUser ? "secondary" : "ghost"}
                onClick={() => navigate("/account")}
                aria-label="Maestro Deck Cloud account"
              >
                <User className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {cloudUser ? `Signed in as ${cloudUser.email}` : "Sign in to Maestro Deck Cloud"}
            </TooltipContent>
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
