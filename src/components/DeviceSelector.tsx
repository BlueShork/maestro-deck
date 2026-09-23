// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  Play,
  Plug,
  PlugZap,
  RefreshCw,
  Stethoscope,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import { AndroidLogo, AppleLogo } from "@/components/BrandIcons";
import { CloudDevicesSection } from "@/components/CloudDevicesSection";
import { CloudPromoCard } from "@/components/CloudPromoCard";
import { LogoCloud } from "@/components/Logo";

import { Button } from "@/components/ui/Button";
import { HealthcheckModal } from "@/components/HealthcheckModal";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import type { Device, HealthReport } from "@/types";
import { isHealthReportClean } from "@/types";

// Booted iOS sims, physical iPhones, and all non-iOS devices render as normal
// rows; only SHUTDOWN iOS simulators go under the "iOS Simulators" group (there
// can be dozens). Physical devices have booted=false but must stay in the main
// list, hence the explicit `!d.physical` guard. Module-level so it's a stable
// reference across renders.
const isShutdownSim = (d: Device) => d.platform === "ios" && !d.booted && !d.physical;

// Shutdown Android AVDs are synthetic entries the backend tags with an
// `avd:` serial prefix; booting one swaps it for the real emulator serial.
const isShutdownAvd = (d: Device) => d.serial.startsWith("avd:");

interface DeviceRowProps {
  device: Device;
  active: boolean;
  /** This row's in-flight action, or null when idle. */
  pending: "connect" | "disconnect" | null;
  isSim: boolean;
  /** Any device action is in flight — block clicks so connects can't race. */
  busy: boolean;
  checking: boolean;
  onConnect: (serial: string) => void;
  onDisconnect: () => void;
  onHealthcheck: (serial: string) => void;
}

/**
 * A single device / simulator row. Memoized so a device action (or the 3s poll)
 * only re-renders the rows whose props actually changed, not the whole list —
 * each row also renders an SVG brand icon, so rebuilding all of them on every
 * parent render is what made the panel feel sluggish.
 */
const DeviceRow = memo(function DeviceRow({
  device: d,
  active,
  pending,
  isSim,
  busy,
  checking,
  onConnect,
  onDisconnect,
  onHealthcheck,
}: DeviceRowProps) {
  const isPending = pending !== null;
  const isConnecting = pending === "connect";
  const isDisconnecting = pending === "disconnect";
  const DeviceIcon = d.platform === "ios" ? AppleLogo : d.platform === "web" ? Globe : AndroidLogo;

  return (
    <li>
      <button
        type="button"
        onClick={() => (active ? void onDisconnect() : void onConnect(d.serial))}
        disabled={busy || isPending}
        aria-busy={isPending}
        className={cn(
          "group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
          // Pending state overrides connected state visually — the
          // shimmer/amber tint tells the user something is happening.
          isConnecting && "border-emerald-500/30 bg-emerald-500/5 animate-pulse",
          isDisconnecting && "border-amber-500/40 bg-amber-500/5 animate-pulse",
          !isPending && active
            ? // Explicit green — primary is the app's theme blue and doesn't
              // read as "connected" at a glance. Tinted background + green
              // border + icon give the device card an unambiguous "live" look.
              "border-emerald-500/50 bg-emerald-500/10 shadow-[inset_0_0_0_1px_rgba(16,185,129,0.15)]"
            : !isPending && "border-transparent hover:border-border hover:bg-accent/40",
        )}
      >
        <div className="relative shrink-0">
          <DeviceIcon
            className={cn(
              "h-4 w-4",
              isConnecting && "text-emerald-500/70",
              isDisconnecting && "text-amber-500",
              !isPending && active && "text-emerald-500",
              !isPending && !active && "text-muted-foreground",
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              "truncate text-xs font-medium",
              isDisconnecting && "text-amber-700 dark:text-amber-300",
              !isPending && active && "text-emerald-700 dark:text-emerald-300",
            )}
          >
            {d.model}
          </div>
          <div
            className={cn(
              "truncate font-mono text-[10px]",
              isConnecting && "text-emerald-600/70 dark:text-emerald-400/70",
              isDisconnecting && "text-amber-600/80 dark:text-amber-400/80",
              !isPending && active
                ? "text-emerald-600/80 dark:text-emerald-400/80"
                : !isPending && "text-muted-foreground",
            )}
          >
            {isConnecting
              ? isSim
                ? "Booting…"
                : "Connecting…"
              : isDisconnecting
                ? "Disconnecting…"
                : d.platform === "web"
                  ? "Chromium"
                  : isSim
                    ? d.platform === "ios"
                      ? `iOS ${d.os_version} · tap to launch`
                      : d.os_version
                        ? `Android ${d.os_version} · tap to launch`
                        : "tap to launch"
                    : d.platform === "ios"
                      ? `${d.serial} · iOS ${d.os_version} · ${d.physical ? "device" : "simulator"}`
                      : `${d.serial} · Android ${d.os_version}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {active && !isPending && d.platform === "android" && (
            <span
              role="button"
              aria-label="Healthcheck device"
              onClick={(e) => {
                e.stopPropagation();
                onHealthcheck(d.serial);
              }}
              className="rounded p-0.5 hover:bg-emerald-500/20"
            >
              {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
              ) : (
                <Stethoscope className="h-3.5 w-3.5 text-emerald-500" />
              )}
            </span>
          )}
          {isPending ? (
            <Loader2
              className={cn(
                "h-3.5 w-3.5 animate-spin",
                isConnecting ? "text-emerald-500" : "text-amber-500",
              )}
            />
          ) : active ? (
            <PlugZap className="h-3.5 w-3.5 text-emerald-500" />
          ) : isSim ? (
            <Play className="h-3.5 w-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
          ) : (
            <Plug className="h-3.5 w-3.5 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
          )}
        </div>
      </button>
    </li>
  );
});

export function DeviceSelector() {
  // Granular selectors: the panel re-renders only when a field it actually uses
  // changes, not on every device-store mutation. Store actions are stable
  // references, so subscribing to them never triggers a re-render.
  const devices = useDeviceStore((s) => s.devices);
  const current = useDeviceStore((s) => s.current);
  const loading = useDeviceStore((s) => s.loading);
  const connecting = useDeviceStore((s) => s.connecting);
  const pendingSerial = useDeviceStore((s) => s.pendingSerial);
  const pendingAction = useDeviceStore((s) => s.pendingAction);
  const error = useDeviceStore((s) => s.error);
  const refresh = useDeviceStore((s) => s.refresh);
  const connect = useDeviceStore((s) => s.connect);
  const disconnect = useDeviceStore((s) => s.disconnect);
  const cloudUser = useCloudAuthStore((s) => s.user);

  // The synthetic "Web Browser (Chromium)" target is hidden unless the user
  // opts into the beta from Settings — the backend always returns it.
  const webBrowserEnabled = useSettingsStore((s) => s.webBrowserEnabled);
  const currentSerial = current?.serial ?? null;

  // Only recompute the split/sort when the inputs actually change, so an
  // unrelated store update doesn't re-filter and re-sort the whole list.
  const { rows, iosSims, androidAvds } = useMemo(() => {
    const isHiddenWeb = (d: Device) =>
      d.platform === "web" && !webBrowserEnabled && currentSerial !== d.serial;
    const rows = devices.filter((d) => !isShutdownSim(d) && !isShutdownAvd(d) && !isHiddenWeb(d));
    const bySimOrder = (a: Device, b: Device) =>
      a.model.localeCompare(b.model) ||
      a.os_version.localeCompare(b.os_version, undefined, { numeric: true });
    const iosSims = devices.filter(isShutdownSim).sort(bySimOrder);
    const androidAvds = devices.filter(isShutdownAvd).sort(bySimOrder);
    return { rows, iosSims, androidAvds };
  }, [devices, webBrowserEnabled, currentSerial]);

  const bootingIos = connecting && iosSims.some((d) => d.serial === pendingSerial);
  const bootingAvd = connecting && androidAvds.some((d) => d.serial === pendingSerial);

  const [checkingSerial, setCheckingSerial] = useState<string | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null);

  const onHealthcheck = useCallback(async (serial: string) => {
    setCheckingSerial(serial);
    try {
      const r = await ipc.checkDeviceHealth(serial);
      if (isHealthReportClean(r)) {
        toast.success("Device clean", "No Maestro residue detected.");
      } else {
        setReport(r);
      }
    } catch (err) {
      toast.error("Healthcheck failed", err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingSerial(null);
    }
  }, []);

  // Auto-detect hotplugged devices: refresh on mount, then poll quietly so
  // a newly plugged-in phone / booted simulator shows up on its own without
  // the user hitting the refresh button. The poll pauses while a connect or
  // disconnect is in flight (to avoid list churn mid-action) and while the
  // window is hidden (no point shelling adb/simctl in the background).
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

  const row = (d: Device) => (
    <DeviceRow
      key={d.serial}
      device={d}
      active={currentSerial === d.serial}
      pending={pendingSerial === d.serial ? pendingAction : null}
      isSim={isShutdownSim(d) || isShutdownAvd(d)}
      busy={connecting}
      checking={checkingSerial === d.serial}
      onConnect={connect}
      onDisconnect={disconnect}
      onHealthcheck={onHealthcheck}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col border-b border-border">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Devices
        </div>
        <Button
          size="icon"
          variant="ghost"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label="Refresh devices"
          className="h-6 w-6"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div className="flex flex-col gap-2 px-3 pb-3">
          {error ? (
            <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
              {error}
            </div>
          ) : null}

          {!loading && devices.length === 0 && !error ? (
            <div className="rounded border border-dashed border-border p-2 text-[11px] text-muted-foreground">
              No devices found. Plug in an Android device (USB debugging) or an iPhone (Developer
              Mode, trusted).
            </div>
          ) : null}

          <ul className="flex flex-col gap-1.5">{rows.map(row)}</ul>

          {iosSims.length > 0 || androidAvds.length > 0 ? (
            <SimulatorsSection
              iosSims={iosSims}
              androidAvds={androidAvds}
              bootingIos={bootingIos}
              bootingAvd={bootingAvd}
              row={row}
            />
          ) : null}

          {/* Unlike Simulators, this section is unconditional: it's the only
              place in the app that asks for a sign-up, and a machine with no
              simulators installed is exactly where the cloud is worth most. */}
          <div className="flex flex-col gap-1.5 pt-1">
            {/* The brand lockup stands in for the section title here. Muted to
                sit at the same weight as the other headings rather than turning
                the sidebar into a billboard. */}
            <LogoCloud className="mb-2 h-9 w-auto self-start text-muted-foreground" />
            {/* Signed in you get the fleet; signed out the card does the asking,
                since there is nothing to run on until there is an account. */}
            {cloudUser ? <CloudDevicesSection /> : null}
          </div>
        </div>
      </div>

      {/* Outside the scroller: the balance is the one thing that stays put, so
          it never scrolls off behind a long device list. */}
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

type SimView = "root" | "ios" | "android";

function SimulatorGroupEntry({
  icon: Icon,
  label,
  count,
  onClick,
}: {
  icon: typeof AppleLogo;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
      >
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
      </button>
    </li>
  );
}

/**
 * The SIMULATORS area: a root view with one drill-in entry per platform,
 * sliding to the platform's device list (back row on top). Local state only —
 * the 3s device poll updates counts/lists without resetting the view, and an
 * emptied group (everything launched / SDK gone) falls back to the root.
 */
function SimulatorsSection({
  iosSims,
  androidAvds,
  bootingIos,
  bootingAvd,
  row,
}: {
  iosSims: Device[];
  androidAvds: Device[];
  bootingIos: boolean;
  bootingAvd: boolean;
  row: (d: Device) => ReactElement;
}) {
  const [view, setView] = useState<SimView>("root");

  useEffect(() => {
    if (view === "ios" && iosSims.length === 0) setView("root");
    if (view === "android" && androidAvds.length === 0) setView("root");
  }, [view, iosSims.length, androidAvds.length]);

  if (view === "root") {
    return (
      <div
        key="root"
        className="flex flex-col gap-1.5 overflow-x-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-4 motion-safe:duration-200"
      >
        <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Simulators
        </div>
        <ul className="flex flex-col gap-1.5">
          {iosSims.length > 0 ? (
            <SimulatorGroupEntry
              icon={AppleLogo}
              label="iOS Simulators"
              count={iosSims.length}
              onClick={() => setView("ios")}
            />
          ) : null}
          {androidAvds.length > 0 ? (
            <SimulatorGroupEntry
              icon={AndroidLogo}
              label="Android Simulators"
              count={androidAvds.length}
              onClick={() => setView("android")}
            />
          ) : null}
        </ul>
      </div>
    );
  }

  const isIos = view === "ios";
  return (
    <div
      key={view}
      className="flex flex-col gap-1.5 overflow-x-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200"
    >
      <button
        type="button"
        onClick={() => setView("root")}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {isIos ? "iOS Simulators" : "Android Simulators"}
      </button>
      <ul className="flex flex-col gap-1.5">{(isIos ? iosSims : androidAvds).map(row)}</ul>
      {isIos && bootingIos ? (
        <div className="text-[11px] text-muted-foreground">
          Booting simulator &amp; starting driver… (can take a minute)
        </div>
      ) : null}
      {!isIos && bootingAvd ? (
        <div className="text-[11px] text-muted-foreground">
          Booting emulator… (can take a minute or two)
        </div>
      ) : null}
    </div>
  );
}
