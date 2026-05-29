// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Apple, Loader2, Plug, PlugZap, RefreshCw, Smartphone, Stethoscope } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { HealthcheckModal } from "@/components/HealthcheckModal";
import { ipc } from "@/lib/ipc";
import { cn } from "@/lib/utils";
import { useDeviceStore } from "@/stores/deviceStore";
import { toast } from "@/stores/toastStore";
import type { HealthReport } from "@/types";
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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-2 border-b border-border p-3">
      <div className="flex items-center justify-between">
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

      {error ? (
        <div className="rounded border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive-foreground">
          {error}
        </div>
      ) : null}

      {!loading && devices.length === 0 && !error ? (
        <div className="rounded border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          No devices found. Plug in an Android device (USB debugging) or an iPhone (Developer Mode,
          trusted).
        </div>
      ) : null}

      <ul className="flex flex-col gap-1">
        {devices.map((d) => {
          const active = current?.serial === d.serial;
          const isPending = pendingSerial === d.serial;
          const isConnecting = isPending && pendingAction === "connect";
          const isDisconnecting = isPending && pendingAction === "disconnect";
          const DeviceIcon = d.platform === "ios" ? Apple : Smartphone;
          return (
            <li key={d.serial}>
              <button
                type="button"
                onClick={() => (active ? void disconnect() : void connect(d.serial))}
                // While *any* device action is in flight we block clicks
                // so the user can't race multiple connects.
                disabled={connecting || isPending}
                aria-busy={isPending}
                className={cn(
                  "group flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-colors",
                  // Pending state overrides connected state visually —
                  // the shimmer/amber tint tells the user something is
                  // happening so they don't assume the row is stuck.
                  isConnecting && "border-emerald-500/30 bg-emerald-500/5 animate-pulse",
                  isDisconnecting && "border-amber-500/40 bg-amber-500/5 animate-pulse",
                  !isPending && active
                    ? // Explicit green — primary is the app's theme blue
                      // and doesn't read as "connected" at a glance.
                      // Pulsing dot + tinted background + border gives
                      // the device card an unambiguous "live" look.
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
                  {active && !isPending ? (
                    <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                  ) : null}
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
                      ? "Connecting…"
                      : isDisconnecting
                        ? "Disconnecting…"
                        : `${d.serial} · ${d.platform === "ios" ? "iOS" : "Android"} ${d.os_version}`}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {active && !isPending && d.platform !== "ios" && (
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
                  ) : (
                    <Plug className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>

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
