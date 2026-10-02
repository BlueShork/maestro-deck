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
      <div className="text-[11px] font-mono font-normal uppercase tracking-[0.02em] text-muted-foreground">
        Device Farm
      </div>
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
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
                  active && "bg-muted",
                )}
              >
                <Smartphone className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{farmDeviceLabel(d)}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    Android {d.androidRelease ?? "?"}
                  </span>
                </span>
                {active ? (
                  <span className="text-[10px] text-brand">
                    {session?.status === "connecting" ? "Connecting…" : "Connected"}
                  </span>
                ) : STATE_LABEL[d.state] ? (
                  <span className="text-[10px] text-muted-foreground">{STATE_LABEL[d.state]}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
