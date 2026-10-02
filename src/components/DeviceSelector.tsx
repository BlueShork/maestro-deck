// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { LayoutGrid, Loader2, RefreshCw, Stethoscope } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { CloudPromoCard } from "@/components/CloudPromoCard";
import { HealthcheckModal } from "@/components/HealthcheckModal";
import { PanelAction, PanelHeader } from "@/components/PanelHeader";
import { PixelChevron } from "@/components/brand/Pixel";
import { DeviceArt } from "@/components/devices/DeviceArt";
import { actionLabel, selectEntry, useCatalog } from "@/components/devices/useCatalog";
import { pickCloudArtifact, useCloudArtifactName } from "@/lib/cloudArtifact";
import type { CatalogEntry } from "@/lib/deviceCatalog";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useDevicePickerStore } from "@/stores/devicePickerStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { toast } from "@/stores/toastStore";
import type { HealthReport } from "@/types";
import { isHealthReportClean } from "@/types";

/** How many ready devices the sidebar offers one click away. */
const QUICK_MAX = 5;

/**
 * The Devices panel: what the next run uses, a quick switch to the devices
 * that are ready right now, and the way into the full device picker (every
 * simulator, farm phone and cloud fleet). The picker does the browsing so the
 * sidebar stays short and readable.
 */
export function DeviceSelector() {
  const loading = useDeviceStore((s) => s.loading);
  const error = useDeviceStore((s) => s.error);
  const refresh = useDeviceStore((s) => s.refresh);
  const pendingSerial = useDeviceStore((s) => s.pendingSerial);
  const pendingAction = useDeviceStore((s) => s.pendingAction);
  const devices = useDeviceStore((s) => s.devices);
  const openPicker = useDevicePickerStore((s) => s.setOpen);
  const entries = useCatalog();

  // The cloud target and a live device can coexist (the device stays
  // connected for the inspector); the run target is what Run uses.
  const target = entries.find((e) => e.state === "target") ?? null;
  const live = entries.find((e) => e.state === "connected") ?? null;
  const active = target ?? live;
  const quick = entries
    .filter((e) => e.source === "local" && e.state === "ready")
    .slice(0, QUICK_MAX);
  const connectingTo =
    pendingAction === "connect" ? devices.find((d) => d.serial === pendingSerial) : undefined;

  const [checking, setChecking] = useState(false);
  const [report, setReport] = useState<HealthReport | null>(null);
  const onHealthcheck = useCallback(async (serial: string) => {
    setChecking(true);
    try {
      const r = await ipc.checkDeviceHealth(serial);
      if (isHealthReportClean(r)) toast.success("Device clean", "No Maestro residue detected.");
      else setReport(r);
    } catch (err) {
      toast.error("Healthcheck failed", err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }, []);

  // Auto-detect hotplugged devices: refresh on mount, then poll quietly so a
  // newly plugged-in phone / booted simulator shows up on its own. The poll
  // pauses while a connect or disconnect is in flight (to avoid list churn
  // mid-action) and while the window is hidden.
  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const s = useDeviceStore.getState();
      if (s.connecting || s.pendingSerial) return;
      void s.refresh({ silent: true });
    }, 3000);
    return () => window.clearInterval(id);
  }, [refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Devices">
        <PanelAction
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh devices"
          title="Refresh devices"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </PanelAction>
        <PanelAction
          onClick={() => openPicker(true)}
          aria-label="Browse all devices"
          title="Browse all devices (⇧⌘D)"
        >
          <LayoutGrid className="h-3.5 w-3.5" />
        </PanelAction>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        {error ? (
          <div className="m-3 border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}

        <section className="flex flex-col gap-2 p-3">
          <span className="mono-label">{target ? "Run target" : "Running on"}</span>
          {connectingTo ? (
            <ConnectingCard name={connectingTo.model} />
          ) : active ? (
            <ActiveCard entry={active} checking={checking} onHealthcheck={onHealthcheck} />
          ) : (
            <EmptyCard onBrowse={() => openPicker(true)} />
          )}
          {target && live ? (
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              {live.name} stays connected for the inspector; Run goes to the cloud.
            </p>
          ) : null}
        </section>

        {quick.length > 0 ? (
          <section className="flex flex-col border-t border-border">
            <span className="mono-label px-3 pb-1.5 pt-3">Ready now</span>
            <ul className="pb-1.5">
              {quick.map((e) => (
                <QuickRow key={e.id} entry={e} />
              ))}
            </ul>
          </section>
        ) : null}

        <button
          type="button"
          onClick={() => openPicker(true)}
          className="group flex w-full items-center justify-between gap-2 border-y border-border px-3 py-3 text-left transition-colors hover:bg-accent"
        >
          <span className="flex min-w-0 flex-col">
            <span className="font-display text-[15px] font-medium tracking-[-0.02em]">
              Browse all devices
            </span>
            <span className="truncate font-mono text-[10px] uppercase text-muted-foreground">
              {entries.length} available · local, farm & cloud
            </span>
          </span>
          <PixelChevron className="shrink-0 transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]" />
        </button>
      </div>

      {/* Outside the scroller: the balance stays put. */}
      <div className="border-t border-border px-3 py-2.5">
        <CloudPromoCard />
      </div>

      {report && (
        <HealthcheckModal
          open={true}
          onOpenChange={(o) => !o && setReport(null)}
          serial={report.device_id}
          report={report}
        />
      )}
    </div>
  );
}

function ActiveCard({
  entry: e,
  checking,
  onHealthcheck,
}: {
  entry: CatalogEntry;
  checking: boolean;
  onHealthcheck: (serial: string) => void;
}) {
  const isTarget = e.state === "target";
  return (
    <div className="relative overflow-hidden rounded-md border border-brand/40 bg-brand/5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-brand" />
      <div className="flex gap-3 p-3">
        <DeviceArt
          platform={e.platform}
          tablet={e.tablet}
          kind={e.kind}
          source={e.source}
          seedKey={e.id}
          className="h-24 w-auto shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "w-fit px-1.5 py-0.5 font-mono text-[9px] uppercase leading-none",
              isTarget ? "bg-brand text-brand-foreground" : "bg-success text-[#101013]",
            )}
          >
            {isTarget ? "Cloud" : e.source === "farm" ? "Farm · live" : "Live"}
          </span>
          <span className="truncate font-display text-[15px] font-medium leading-tight tracking-[-0.02em]">
            {e.name}
          </span>
          <span className="truncate font-mono text-[10px] uppercase text-muted-foreground">
            {e.os}
          </span>
          <span className="truncate text-[10px] text-muted-foreground" title={e.detail}>
            {e.detail}
          </span>
        </div>
      </div>
      {e.source === "cloud" ? <ArtifactLine platform={e.cloud} /> : null}
      <div className="flex border-t border-brand/20">
        <button
          type="button"
          onClick={() => void selectEntry(e)}
          className="flex-1 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {actionLabel(e)}
        </button>
        {e.source === "local" && e.platform === "android" ? (
          <button
            type="button"
            onClick={() => onHealthcheck(e.device.serial)}
            aria-label="Healthcheck device"
            title="Check for Maestro leftovers on the device"
            className="flex w-9 items-center justify-center border-l border-brand/20 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            {checking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Stethoscope className="h-3.5 w-3.5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ArtifactLine({
  platform,
}: {
  platform: Extract<CatalogEntry, { source: "cloud" }>["cloud"];
}) {
  const name = useCloudArtifactName(platform);
  return (
    <button
      type="button"
      onClick={() => void pickCloudArtifact(platform)}
      className="flex w-full items-center justify-between gap-2 border-t border-brand/20 px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={name ?? undefined}
    >
      <span className="truncate font-mono">{name ?? "No build chosen"}</span>
      <span className="shrink-0 font-mono text-[10px] uppercase text-brand">
        {name ? "Change" : "Choose"}
      </span>
    </button>
  );
}

function ConnectingCard({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-3">
      <span aria-hidden className="step-pip step-pip-running" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[15px] font-medium tracking-[-0.02em]">
          {name}
        </span>
        <span className="font-mono text-[10px] uppercase text-muted-foreground">
          Connecting · a simulator can take a minute
        </span>
      </span>
    </div>
  );
}

function EmptyCard({ onBrowse }: { onBrowse: () => void }) {
  return (
    <button
      type="button"
      onClick={onBrowse}
      className="group flex items-center gap-3 rounded-md border border-border bg-surface p-3 text-left transition-colors hover:border-foreground/20"
    >
      <DeviceArt
        platform="android"
        kind="physical"
        source="local"
        dim
        seedKey="empty"
        className="h-16 w-auto shrink-0"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="font-display text-[15px] font-medium leading-tight tracking-[-0.02em]">
          No device yet
        </span>
        <span className="text-[11px] leading-snug text-muted-foreground">
          Plug in a phone, start a simulator or pick one in the cloud.
        </span>
        <span className="mt-1 flex items-center gap-2 font-mono text-[10px] uppercase text-brand">
          Choose a device
          <PixelChevron
            size={8}
            className="transition-transform duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px]"
          />
        </span>
      </span>
    </button>
  );
}

function QuickRow({ entry: e }: { entry: CatalogEntry }) {
  const busy = useDeviceStore((s) => s.connecting);
  return (
    <li>
      <button
        type="button"
        onClick={() => void selectEntry(e)}
        disabled={busy}
        className="group flex w-full items-center gap-3 px-3 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-50"
      >
        <DeviceArt
          platform={e.platform}
          tablet={e.tablet}
          kind={e.kind}
          source={e.source}
          seedKey={e.id}
          className="h-9 w-auto shrink-0"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium">{e.name}</span>
          <span className="truncate font-mono text-[10px] uppercase text-muted-foreground">
            {e.os}
          </span>
        </span>
        <PixelChevron className="shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 [transition-timing-function:steps(2,end)] group-hover:translate-x-[3px] group-hover:opacity-100" />
      </button>
    </li>
  );
}
