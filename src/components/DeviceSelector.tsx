// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Globe, Loader2, Play, Plug, PlugZap, RefreshCw, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";

import { AndroidLogo, AppleLogo } from "@/components/BrandIcons";

import { Button } from "@/components/ui/Button";
import { HealthcheckModal } from "@/components/HealthcheckModal";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";
import type { Device, HealthReport } from "@/types";
import { isHealthReportClean } from "@/types";

export function DeviceSelector() {
  const {
    devices,
    current,
    loading,
    connecting,
    pendingSerial,
    pendingAction,
    error,
    refresh,
    connect,
    disconnect,
  } = useDeviceStore();

  // The synthetic "Web Browser (Chromium)" target is hidden unless the user
  // opts into the beta from Settings — the backend always returns it.
  const webBrowserEnabled = useSettingsStore((s) => s.webBrowserEnabled);

  // Booted iOS sims, physical iPhones, and all non-iOS devices render as normal
  // rows; only SHUTDOWN iOS simulators go into the "Launch a simulator…" picker
  // (there can be dozens). Physical devices have booted=false but must stay in
  // the main list, hence the explicit `!d.physical` guard.
  const isShutdownSim = (d: Device) => d.platform === "ios" && !d.booted && !d.physical;
  // Hide the web target when the beta is off — but never hide it while it's the
  // active connection, or the user couldn't disconnect it after toggling off.
  const isHiddenWeb = (d: Device) =>
    d.platform === "web" && !webBrowserEnabled && current?.serial !== d.serial;
  const rows = devices.filter((d) => !isShutdownSim(d) && !isHiddenWeb(d));
  const shutdownSims = devices
    .filter(isShutdownSim)
    .sort(
      (a, b) =>
        a.model.localeCompare(b.model) ||
        a.os_version.localeCompare(b.os_version, undefined, { numeric: true }),
    );
  const bootingSim = connecting && shutdownSims.some((d) => d.serial === pendingSerial);

  const [checkingSerial, setCheckingSerial] = useState<string | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null);

  const onHealthcheck = async (serial: string) => {
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
  };

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

  // Shared row for both connected/available devices and the (shut-down) iOS
  // simulators. Sims render as regular tappable rows — clicking one boots it
  // and connects — instead of hiding behind a dropdown.
  const renderRow = (d: Device) => {
    const active = current?.serial === d.serial;
    const isPending = pendingSerial === d.serial;
    const isConnecting = isPending && pendingAction === "connect";
    const isDisconnecting = isPending && pendingAction === "disconnect";
    const isSim = isShutdownSim(d);
    const DeviceIcon =
      d.platform === "ios" ? AppleLogo : d.platform === "web" ? Globe : AndroidLogo;
    return (
      <li key={d.serial}>
        <button
          type="button"
          onClick={() => (active ? void disconnect() : void connect(d.serial))}
          // While *any* device action is in flight we block clicks so the
          // user can't race multiple connects.
          disabled={connecting || isPending}
          aria-busy={isPending}
          className={cn(
            "group flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
            // Pending state overrides connected state visually — the
            // shimmer/amber tint tells the user something is happening.
            isConnecting && "border-emerald-500/30 bg-emerald-500/5 animate-pulse",
            isDisconnecting && "border-amber-500/40 bg-amber-500/5 animate-pulse",
            !isPending && active
              ? // Explicit green — primary is the app's theme blue and
                // doesn't read as "connected" at a glance. Tinted
                // background + green border + icon give the device card
                // an unambiguous "live" look.
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
                      ? `iOS ${d.os_version} · tap to launch`
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
                  void onHealthcheck(d.serial);
                }}
                className="rounded p-0.5 hover:bg-emerald-500/20"
              >
                {checkingSerial === d.serial ? (
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
  };

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

          <ul className="flex flex-col gap-1.5">{rows.map(renderRow)}</ul>

          {shutdownSims.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                iOS Simulators
              </div>
              <ul className="flex flex-col gap-1.5">{shutdownSims.map(renderRow)}</ul>
              {bootingSim ? (
                <div className="text-[11px] text-muted-foreground">
                  Booting simulator &amp; starting driver… (can take a minute)
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
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
