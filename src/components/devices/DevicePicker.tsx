// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Cloud,
  Globe,
  Laptop,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { PixelChevron } from "@/components/brand/Pixel";
import { DeviceArt } from "@/components/devices/DeviceArt";
import {
  actionLabel,
  isSelectable,
  selectEntry,
  useCatalog,
} from "@/components/devices/useCatalog";
import { Button } from "@/components/ui/Button";
import { pickCloudArtifact, useCloudArtifactName } from "@/lib/cloudArtifact";
import {
  filterCatalog,
  type CatalogEntry,
  type CatalogFilter,
  type CatalogKind,
  type CatalogSource,
} from "@/lib/deviceCatalog";
import { cn } from "@/lib/utils";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFarmStore } from "@/stores/farmStore";

const FARM_REFRESH_MS = 15_000;

const SOURCE_FILTERS: Array<{ id: CatalogFilter["source"]; label: string; icon: typeof Layers }> = [
  { id: "all", label: "Everywhere", icon: Layers },
  { id: "local", label: "This machine", icon: Laptop },
  { id: "cloud", label: "Maestro Deck Cloud", icon: Cloud },
];

const KIND_FILTERS: Array<{ id: CatalogFilter["kind"]; label: string }> = [
  { id: "all", label: "All types" },
  { id: "physical", label: "Physical" },
  { id: "simulator", label: "Simulators" },
  { id: "web", label: "Web" },
];

const SOURCE_LABEL: Record<CatalogSource, string> = {
  local: "Local",
  farm: "Farm",
  cloud: "Cloud",
};

const KIND_LABEL: Record<CatalogKind, string> = {
  physical: "Physical",
  simulator: "Simulator",
  web: "Web",
};

/** Sections of the grid, in reading order. */
const GROUPS: Array<{ id: string; title: string; match: (e: CatalogEntry) => boolean }> = [
  {
    id: "active",
    title: "In use",
    match: (e) => e.state === "connected" || e.state === "target",
  },
  {
    id: "local-physical",
    title: "Plugged into this machine",
    match: (e) => e.source === "local" && e.kind === "physical",
  },
  {
    id: "local-sim",
    title: "Simulators & emulators",
    match: (e) => e.source === "local" && e.kind === "simulator",
  },
  { id: "local-web", title: "Web", match: (e) => e.source === "local" && e.kind === "web" },
  { id: "farm", title: "Device farm · real phones, live", match: (e) => e.source === "farm" },
  { id: "cloud", title: "Cloud fleets · run targets", match: (e) => e.source === "cloud" },
];

/**
 * Every device a flow can run on, in one place: local phones, simulators and
 * emulators, the web target, farm phones and the cloud fleets. Laid out like
 * the landing's overview — a filter rail of nav cells, then tiles sharing
 * hairlines, each with its own pixel illustration.
 */
export function DevicePicker() {
  const open = useDevicePickerStore((s) => s.open);
  const setOpen = useDevicePickerStore((s) => s.setOpen);
  const navigate = useNavigate();
  const entries = useCatalog();
  const signedIn = useCloudAuthStore((s) => s.user !== null);
  const loading = useDeviceStore((s) => s.loading);
  const refresh = useDeviceStore((s) => s.refresh);
  const refreshFarm = useFarmStore((s) => s.refreshDevices);
  const farmError = useFarmStore((s) => s.devicesError);

  const [source, setSource] = useState<CatalogFilter["source"]>("all");
  const [kind, setKind] = useState<CatalogFilter["kind"]>("all");
  const [query, setQuery] = useState("");

  // Farm availability changes on its own; keep it fresh while the picker is up.
  useEffect(() => {
    if (!open || !signedIn) return;
    void refreshFarm();
    const id = window.setInterval(() => void refreshFarm(), FARM_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [open, signedIn, refreshFarm]);

  const visible = useMemo(
    () => filterCatalog(entries, { source, kind, query }),
    [entries, source, kind, query],
  );
  const count = (f: Partial<CatalogFilter>) =>
    filterCatalog(entries, { source: "all", kind: "all", query: "", ...f }).length;

  const pick = async (e: CatalogEntry) => {
    const done = await selectEntry(e);
    // Releasing keeps the picker open so another device can be chosen.
    if (done && e.state !== "connected" && e.state !== "target") setOpen(false);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-black/70 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="warm-bands fixed left-1/2 top-1/2 z-[101] flex h-[min(780px,calc(100vh-3rem))] w-[min(1180px,calc(100vw-3rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {/* Header: title cell, search, refresh, close — landing nav cells. */}
          <div className="flex h-16 shrink-0 items-stretch border-b border-border pt-1.5">
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-5">
              <span className="mono-label">Devices</span>
              <DialogPrimitive.Title className="font-display text-xl font-medium leading-none tracking-[-0.03em]">
                Where should this flow run?
              </DialogPrimitive.Title>
            </div>
            <label className="flex w-72 items-center gap-2 border-l border-border px-4 text-muted-foreground focus-within:text-foreground">
              <Search className="h-3.5 w-3.5 shrink-0" />
              <input
                value={query}
                onChange={(ev) => setQuery(ev.target.value)}
                placeholder="Search name, OS, serial…"
                aria-label="Search devices"
                className="h-full w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                void refresh();
                if (signedIn) void refreshFarm();
              }}
              aria-label="Refresh devices"
              title="Refresh"
              className="flex w-14 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
            <DialogPrimitive.Close
              aria-label="Close"
              className="flex w-14 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Filter rail. */}
            <nav className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border py-3">
              <RailLabel>Source</RailLabel>
              {SOURCE_FILTERS.map(({ id, label, icon: Icon }) => (
                <RailItem
                  key={id}
                  active={source === id}
                  onClick={() => setSource(id)}
                  icon={<Icon className="h-4 w-4" />}
                  label={label}
                  count={count({ source: id })}
                />
              ))}
              <RailLabel className="mt-5">Type</RailLabel>
              {KIND_FILTERS.map(({ id, label }) => (
                <RailItem
                  key={id}
                  active={kind === id}
                  onClick={() => setKind(id)}
                  icon={
                    id === "web" ? (
                      <Globe className="h-4 w-4" />
                    ) : id === "simulator" ? (
                      <Laptop className="h-4 w-4" />
                    ) : (
                      <Smartphone className="h-4 w-4" />
                    )
                  }
                  label={label}
                  count={count({ kind: id })}
                />
              ))}

              <div className="mt-auto px-4 pt-6">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="text-foreground">Live</span> devices mirror their screen here and
                  work with the inspector. <span className="text-foreground">Cloud fleets</span> are
                  run targets: Run sends the flow there and streams the result back.
                </p>
              </div>
            </nav>

            {/* Tiles. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {GROUPS.map((g) => {
                const items = visible.filter(
                  (e) =>
                    g.match(e) &&
                    // An entry in use is shown once, in the top group.
                    (g.id === "active" || (e.state !== "connected" && e.state !== "target")),
                );
                if (items.length === 0) return null;
                return (
                  <section key={g.id} className="border-b border-border">
                    <div className="flex items-center gap-2 px-5 pb-2 pt-5">
                      <span className="mono-label">{g.title}</span>
                      <span className="bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {items.length}
                      </span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] border-t border-border">
                      {items.map((e) => (
                        <DeviceTile key={e.id} entry={e} onPick={() => void pick(e)} />
                      ))}
                    </div>
                  </section>
                );
              })}

              {source !== "local" && !signedIn ? (
                <CloudSignInTile
                  onSignIn={() => {
                    setOpen(false);
                    navigate("/account");
                  }}
                />
              ) : null}

              {signedIn && farmError && source !== "local" ? (
                <p className="px-5 py-3 text-[11px] text-muted-foreground">
                  Device farm unavailable: {farmError}
                </p>
              ) : null}

              {visible.length === 0 && (signedIn || source === "local") ? (
                <div className="flex flex-col items-start gap-2 p-8">
                  <span className="mono-label">No match</span>
                  <p className="font-display text-2xl font-medium tracking-[-0.03em]">
                    Nothing here yet.
                  </p>
                  <p className="max-w-md text-sm text-muted-foreground">
                    Plug in an Android phone with USB debugging, trust this computer on an iPhone,
                    or install a simulator — it shows up on its own.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function RailLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mono-label px-4 pb-1.5 text-[10px]", className)}>{children}</div>;
}

function RailItem({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
        active
          ? "bg-accent font-medium text-foreground shadow-[inset_2px_0_0_hsl(var(--brand))]"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <span className={cn("shrink-0", active && "text-brand")}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

function StateBadge({ entry: e }: { entry: CatalogEntry }) {
  const map: Partial<Record<CatalogEntry["state"], { label: string; className: string }>> = {
    connected: { label: "Live", className: "bg-success text-[#101013]" },
    target: { label: "Run target", className: "bg-brand text-brand-foreground" },
    off: { label: "Shut down", className: "bg-surface text-muted-foreground" },
    in_use: { label: "In use", className: "bg-warning/15 text-warning" },
    offline: { label: "Offline", className: "bg-surface text-muted-foreground" },
  };
  const look = map[e.state];
  if (!look) return null;
  return (
    <span
      className={cn("px-1.5 py-0.5 font-mono text-[9px] uppercase leading-none", look.className)}
    >
      {look.label}
    </span>
  );
}

function DeviceTile({ entry: e, onPick }: { entry: CatalogEntry; onPick: () => void }) {
  const selectable = isSelectable(e);
  const pendingSerial = useDeviceStore((s) => s.pendingSerial);
  const farmConnecting = useFarmStore(
    (s) =>
      s.session?.status === "connecting" && e.source === "farm" && s.session.deviceId === e.farm.id,
  );
  const pending = (e.source === "local" && pendingSerial === e.device.serial) || farmConnecting;
  const live = e.state === "connected" || e.state === "target";

  return (
    <div
      className={cn(
        "group relative flex flex-col border-b border-r border-border transition-colors",
        live ? "bg-brand/5" : selectable && "hover:bg-accent",
        !selectable && "opacity-60",
      )}
    >
      {live ? <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand" /> : null}
      <button
        type="button"
        onClick={onPick}
        disabled={!selectable || pending}
        className="flex flex-1 flex-col text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
      >
        <div className="flex items-start justify-between gap-2 px-4 pt-4">
          <div className="flex flex-wrap gap-1">
            <span className="bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase leading-none text-muted-foreground">
              {SOURCE_LABEL[e.source]}
            </span>
            <span className="bg-surface px-1.5 py-0.5 font-mono text-[9px] uppercase leading-none text-muted-foreground">
              {KIND_LABEL[e.kind]}
            </span>
          </div>
          <StateBadge entry={e} />
        </div>
        <div className="flex h-36 items-center justify-center px-4 py-3">
          <DeviceArt
            platform={e.platform}
            tablet={e.tablet}
            kind={e.kind}
            source={e.source}
            dim={e.state === "off" || e.state === "offline"}
            seedKey={e.id}
            className={cn(
              "h-full w-auto transition-transform duration-200 [transition-timing-function:steps(3,end)]",
              selectable && "group-hover:-translate-y-1",
            )}
          />
        </div>
        <div className="flex flex-col gap-0.5 px-4">
          <span className="truncate font-display text-[15px] font-medium tracking-[-0.02em]">
            {e.name}
          </span>
          <span className="truncate font-mono text-[10px] uppercase text-muted-foreground">
            {e.os}
          </span>
          <span className="truncate text-[11px] text-muted-foreground" title={e.detail}>
            {e.detail}
          </span>
        </div>
        <div
          className={cn(
            "mt-3 flex items-center justify-between border-t border-border px-4 py-2.5 text-xs font-medium",
            live
              ? "text-muted-foreground"
              : selectable
                ? "text-foreground"
                : "text-muted-foreground",
          )}
        >
          <span className="flex items-center gap-2">
            {pending ? <Loader2 className="h-3 w-3 animate-spin text-brand" /> : null}
            {pending ? "Connecting…" : actionLabel(e)}
          </span>
          {selectable && !live && !pending ? (
            <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
          ) : null}
        </div>
      </button>
      {e.source === "cloud" ? <ArtifactRow platform={e.cloud} /> : null}
    </div>
  );
}

/** The build a cloud fleet installs, with a way to change it. */
function ArtifactRow({
  platform,
}: {
  platform: Extract<CatalogEntry, { source: "cloud" }>["cloud"];
}) {
  const name = useCloudArtifactName(platform);
  return (
    <button
      type="button"
      onClick={() => void pickCloudArtifact(platform)}
      className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={name ?? undefined}
    >
      <span className="truncate font-mono">
        {name ?? (platform === "ios" ? "No .app chosen" : "No .apk chosen")}
      </span>
      <span className="shrink-0 font-mono text-[10px] uppercase text-brand">
        {name ? "Change" : "Choose"}
      </span>
    </button>
  );
}

function CloudSignInTile({ onSignIn }: { onSignIn: () => void }) {
  return (
    <section className="grid border-b border-border md:grid-cols-[1fr_auto]">
      <div className="flex flex-col gap-2 p-5">
        <span className="mono-label">Maestro Deck Cloud</span>
        <p className="font-display text-2xl font-medium leading-tight tracking-[-0.03em]">
          Real phones and simulators you don't own.
        </p>
        <p className="max-w-lg text-sm text-muted-foreground">
          Sign in to open live sessions on the device farm, or send runs to hosted Android emulators
          and iOS simulators. New accounts get 20 free runs.
        </p>
        <Button onClick={onSignIn} className="group mt-2 h-9 w-fit gap-2.5 px-4">
          Sign in
          <PixelChevron className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
        </Button>
      </div>
      <div className="hidden items-end gap-3 border-l border-border px-8 pt-6 md:flex">
        <DeviceArt
          platform="android"
          kind="physical"
          source="farm"
          seedKey="promo-farm"
          className="h-32 w-auto"
        />
        <DeviceArt
          platform="ios"
          kind="simulator"
          source="cloud"
          seedKey="promo-ios"
          className="h-36 w-auto"
        />
      </div>
    </section>
  );
}
