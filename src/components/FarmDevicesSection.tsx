// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Smartphone } from "lucide-react";
import { useEffect } from "react";

import { farmDeviceLabel, type FarmDevice } from "@/lib/farmApi";
import { cn } from "@/lib/utils";
import { useFarmStore } from "@/stores/farmStore";

const REFRESH_MS = 15_000;

const STATE_LABEL: Record<FarmDevice["state"], string | null> = {
  available: null,
  in_use: "In use",
  offline: "Offline",
};

/**
 * Real phones in the device farm, opened as a remote session that then
 * behaves like a local Android device (screen, input, inspector, runs).
 */
export function FarmDevicesSection() {
  const devices = useFarmStore((s) => s.devices);
  const session = useFarmStore((s) => s.session);
  const error = useFarmStore((s) => s.devicesError);
  const refresh = useFarmStore((s) => s.refreshDevices);
  const connect = useFarmStore((s) => s.connect);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="mono-label">Device Farm</div>
      {error ? <div className="text-[11px] text-muted-foreground">{error}</div> : null}
      {devices.length === 0 && !error ? (
        <div className="text-[11px] text-muted-foreground">No farm phone online right now.</div>
      ) : null}
      <ul className="flex flex-col gap-1">
        {devices.map((d) => {
          const busy = d.state !== "available" || session !== null;
          const active = session?.deviceId === d.id;
          return (
            <li key={d.id}>
              <button
                type="button"
                disabled={busy && !active}
                onClick={() => !busy && void connect(d)}
                className={cn(
                  // Same row as a local device: orange rule + wash when live.
                  "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  active
                    ? "border-brand/40 bg-brand/10 shadow-[inset_2px_0_0_hsl(var(--brand))]"
                    : "border-transparent hover:border-border hover:bg-accent/40",
                )}
              >
                <Smartphone
                  className={cn(
                    "h-4 w-4 shrink-0",
                    active ? "text-brand" : "text-muted-foreground",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{farmDeviceLabel(d)}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    Android {d.androidRelease ?? "?"}
                  </span>
                </span>
                {active ? (
                  <span className="font-mono text-[10px] uppercase text-brand">
                    {session?.status === "connecting" ? "Connecting…" : "Connected"}
                  </span>
                ) : STATE_LABEL[d.state] ? (
                  <span className="font-mono text-[10px] uppercase text-muted-foreground">
                    {STATE_LABEL[d.state]}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
