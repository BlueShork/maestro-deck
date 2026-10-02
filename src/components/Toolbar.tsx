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
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { PixelChevron, PixelIcon } from "@/components/brand/Pixel";
import { DeviceArt } from "@/components/devices/DeviceArt";
import { useCatalog } from "@/components/devices/useCatalog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/Tooltip";
import { tierLabel } from "@/lib/cloudAuth";
import { CLOUD_ARTIFACTS, CLOUD_TARGET_LABELS } from "@/lib/cloudRunner";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chatStore";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
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
            "inline-flex items-center gap-1 px-1.5 py-0.5 font-mono text-[10px] uppercase leading-4 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            paid
              ? "bg-brand text-brand-foreground hover:bg-brand/90"
              : "bg-surface text-muted-foreground hover:text-foreground",
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
    <span className="flex items-center border-l border-border px-3 font-mono text-[10px] uppercase text-muted-foreground">
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

/** One hairline-separated cell of the toolbar, like the landing nav items. */
const ToolbarCell = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; icon?: boolean }
>(({ active, icon, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "relative flex shrink-0 items-center justify-center gap-2 border-l border-border text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
      icon ? "w-11" : "px-4",
      active && "bg-accent shadow-[inset_0_-2px_0_hsl(var(--brand))]",
      className,
    )}
    {...props}
  />
));
ToolbarCell.displayName = "ToolbarCell";

/** Toolbar cell naming what Run will use, opening the device picker. */
function DeviceCell() {
  const entries = useCatalog();
  const setOpen = useDevicePickerStore((s) => s.setOpen);
  const active =
    entries.find((e) => e.state === "target") ??
    entries.find((e) => e.state === "connecting") ??
    entries.find((e) => e.state === "connected");
  const connecting = active?.state === "connecting";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ToolbarCell
          onClick={() => setOpen(true)}
          aria-label="Choose a device"
          className="group/dev max-w-[16rem] gap-2.5"
        >
          {active ? (
            <DeviceArt
              platform={active.platform}
              tablet={active.tablet}
              kind={active.kind}
              source={active.source}
              seedKey={active.id}
              className="h-6 w-auto shrink-0"
            />
          ) : (
            <span aria-hidden className="h-2 w-2 shrink-0 border border-muted-foreground" />
          )}
          <span className="min-w-0 truncate">{active ? active.name : "Choose a device"}</span>
          {connecting ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-brand" /> : null}
          <PixelChevron direction="down" size={10} className="shrink-0 text-muted-foreground" />
        </ToolbarCell>
      </TooltipTrigger>
      <TooltipContent>All devices — local, farm & cloud (⇧⌘D)</TooltipContent>
    </Tooltip>
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
  // `useShallow`: the selector builds a fresh object on every call, which a
  // plain subscription reads as a new snapshot each render — React then loops
  // ("Maximum update depth exceeded") and unmounts the whole app the moment
  // setup starts.
  const setupChip = useEnvStore(useShallow(selectSetupChip));
  // A cloud run uploads the flow and needs nothing installed here, so the
  // local toolchain must never gate it.
  const localToolsMissing = useEnvStore((s) => s.minimalOk === false);

  return (
    <TooltipProvider delayDuration={200}>
      {/* Landing nav: a row of hairline-separated cells, the active one lit
          with an orange underline, the main call to action as a light cell
          pinned to the right edge. */}
      <header className="flex h-12 shrink-0 items-stretch border-b border-border bg-background">
        <div className="flex w-12 shrink-0 items-center justify-center border-r border-border">
          <PixelIcon size={26} />
        </div>
        <div className="flex items-center gap-3 border-r border-border px-4">
          <span className="font-display text-[15px] font-medium tracking-[-0.02em] text-foreground">
            Maestro Deck
          </span>
          <PackBadge />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <ToolbarCell
              onClick={() => void checkUpdate()}
              disabled={updatePhase === "checking"}
              className="border-l-0 border-r font-mono text-[11px] uppercase text-muted-foreground"
            >
              {updatePhase === "checking" ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  checking…
                </>
              ) : (
                `v${__APP_VERSION__}`
              )}
            </ToolbarCell>
          </TooltipTrigger>
          <TooltipContent>Check for updates</TooltipContent>
        </Tooltip>

        <div className="ml-auto flex items-stretch">
          <FpsBadge />

          <DeviceCell />

          {/* Beside Run, because that is where someone reaches when nothing
              happens. Clicking opens the setup panel with the detail. */}
          {setupChip ? (
            <ToolbarCell
              onClick={() => useEnvStore.getState().setCollapsed(false)}
              className={cn(
                "font-mono text-[11px] uppercase",
                setupChip.state === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {setupChip.state === "installing" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              {setupChip.text}
            </ToolbarCell>
          ) : null}

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarCell
                icon
                active={inspectEnabled}
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
              </ToolbarCell>
            </TooltipTrigger>
            <TooltipContent>
              {inspectLoading
                ? inspectEnabled
                  ? "Refreshing hierarchy…"
                  : "Dumping hierarchy…"
                : "Inspect (I)"}
            </TooltipContent>
          </Tooltip>

          {/* Non-modal: modal mode inert-marks the whole app (canvas, editor)
              on open/close — visible jank. See ModelPicker for details. */}
          <DropdownMenu modal={false}>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <ToolbarCell icon aria-label="Toggle panels">
                    <LayoutPanelLeft className="h-4 w-4" />
                  </ToolbarCell>
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
              <ToolbarCell
                icon
                active={chatOpen}
                onClick={toggleChat}
                aria-label="Toggle AI assistant"
                data-tour="chat-toggle"
              >
                <Sparkles className="h-4 w-4" />
              </ToolbarCell>
            </TooltipTrigger>
            <TooltipContent>AI assistant</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarCell
                icon
                onClick={() => void openUrl("https://www.maestrodeck.cloud/docs")}
                aria-label="Open documentation"
              >
                <BookOpen className="h-4 w-4" />
              </ToolbarCell>
            </TooltipTrigger>
            <TooltipContent>Documentation</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarCell
                icon
                data-tour="image-bank"
                onClick={() => navigate("/image-bank")}
                aria-label="Open image bank"
              >
                <Images className="h-4 w-4" />
              </ToolbarCell>
            </TooltipTrigger>
            <TooltipContent>Image bank</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarCell
                icon
                onClick={() => navigate("/account")}
                aria-label="Maestro Deck Cloud account"
              >
                <User className="h-4 w-4" />
                {cloudUser ? (
                  <span aria-hidden className="absolute right-2.5 top-3 h-1.5 w-1.5 bg-brand" />
                ) : null}
              </ToolbarCell>
            </TooltipTrigger>
            <TooltipContent>
              {cloudUser ? `Signed in as ${cloudUser.email}` : "Sign in to Maestro Deck Cloud"}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <ToolbarCell icon onClick={() => navigate("/settings")} aria-label="Settings">
                <Settings className="h-4 w-4" />
              </ToolbarCell>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>

          <div data-tour="run-controls" className="flex items-stretch">
            {starting ? (
              <ToolbarCell disabled className="min-w-[7.5rem] bg-destructive text-white">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting…
              </ToolbarCell>
            ) : running ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <ToolbarCell
                    onClick={onStop}
                    className="min-w-[7.5rem] bg-destructive text-white hover:bg-destructive/90"
                  >
                    <Square className="h-3.5 w-3.5" fill="currentColor" />
                    {cloudRun ? "Stop watching" : "Stop"}
                  </ToolbarCell>
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
                    <ToolbarCell onClick={onRunAll} disabled={!folderPath || cloudTarget !== null}>
                      <ListChecks className="h-4 w-4" />
                      Run all
                    </ToolbarCell>
                  </TooltipTrigger>
                  <TooltipContent>
                    {cloudTarget
                      ? "Run all is local-only for now — clear the cloud target to use it"
                      : folderPath
                        ? "Run every flow in the workspace"
                        : "Open a folder to enable"}
                  </TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* The button names its destination. Running in the cloud
                        costs a run and cannot be cancelled, so the difference
                        has to be visible before the click, not after. */}
                    <ToolbarCell
                      onClick={onRun}
                      disabled={cloudTarget !== null ? !cloudApk : localToolsMissing}
                      className="group/run min-w-[7.5rem] bg-primary text-primary-foreground hover:bg-primary/90 dark:hover:bg-white"
                    >
                      {cloudTarget ? (
                        <Cloud className="h-4 w-4" />
                      ) : (
                        <Play className="h-3.5 w-3.5" fill="currentColor" />
                      )}
                      {cloudTarget ? "Run in cloud" : "Run"}
                      <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover/run:translate-x-[3px]" />
                    </ToolbarCell>
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
              </>
            )}
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}
