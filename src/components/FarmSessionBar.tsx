// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { Loader2, LogOut, Package, Timer } from "lucide-react";

import { PanelAction } from "@/components/PanelHeader";
import { cn } from "@/lib/utils";
import { useFarmStore } from "@/stores/farmStore";

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Shown under the Device panel header while a farm phone is held. */
export function FarmSessionBar() {
  const session = useFarmStore((s) => s.session);
  const warnings = useFarmStore((s) => s.warnings);
  const installing = useFarmStore((s) => s.installing);
  const release = useFarmStore((s) => s.release);
  const installApk = useFarmStore((s) => s.installApk);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!session) return null;
  const minutesLeft = session.maxEndsAt
    ? Math.max(0, Math.ceil((session.maxEndsAt - now) / 60_000))
    : session.minutesRemaining;

  const pickApk = async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "Android app", extensions: ["apk"] }],
    });
    if (typeof path === "string") await installApk(path);
  };

  const connecting = session.status === "connecting";
  const reconnecting = session.status === "reconnecting";
  // Share of the session still ahead, for the stepped time bar.
  const span = session.maxEndsAt - session.startedAt;
  const left = span > 0 ? Math.min(1, Math.max(0, (session.maxEndsAt - now) / span)) : 1;
  const low = !connecting && minutesLeft <= 5;

  const warning = (text: string) => (
    <div className="flex items-center gap-2 border-t border-border bg-warning/10 px-3 py-1.5 text-[11px] text-foreground shadow-[inset_2px_0_0_hsl(var(--warning))]">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse bg-warning" />
      {text}
    </div>
  );

  // A sub-row of the Device panel header, cut into the same hairline cells:
  // who you are holding, the clock, the time left, then the actions.
  return (
    <div className="shrink-0 border-b border-border bg-background">
      <div className="flex h-9 items-stretch">
        <div className="flex min-w-0 items-center gap-2 px-3">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0",
              connecting || reconnecting ? "animate-pulse bg-brand" : "bg-success",
            )}
          />
          <span className="bg-brand px-1.5 py-0.5 font-mono text-[9px] uppercase leading-none text-brand-foreground">
            Farm
          </span>
          <span className="truncate font-mono text-[11px] text-foreground">{session.label}</span>
        </div>

        {connecting ? (
          // No minutes or clock yet: the dashboard is still reserving the phone.
          <div className="flex items-center gap-1.5 border-l border-border px-3 font-mono text-[10px] uppercase text-brand">
            <Loader2 className="h-3 w-3 animate-spin" />
            Opening session…
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-1.5 border-l border-border px-3 font-mono text-[11px] tabular-nums text-muted-foreground"
              title="Time in this session"
            >
              <Timer className="h-3 w-3" />
              {mmss(now - session.startedAt)}
            </div>
            <div className="flex items-center border-l border-border px-3">
              <span
                className={cn(
                  "font-mono text-[10px] uppercase",
                  low ? "text-warning" : "text-muted-foreground",
                )}
              >
                {minutesLeft} min left
              </span>
            </div>
          </>
        )}

        <div className="flex-1" />

        <PanelAction
          wide
          disabled={installing || session.status !== "active"}
          onClick={() => void pickApk()}
          title="Install an .apk on the farm phone"
        >
          {installing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Package className="h-3.5 w-3.5" />
          )}
          {installing ? "Installing…" : "Install APK"}
        </PanelAction>
        <PanelAction
          wide
          onClick={() => void release()}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          title={connecting ? "Stop opening the session" : "Give the phone back to the farm"}
        >
          <LogOut className="h-3.5 w-3.5" />
          {connecting ? "Cancel" : "Release"}
        </PanelAction>
      </div>

      {/* The session's time, burning down in steps like the landing CI bar. */}
      {!connecting ? (
        <div aria-hidden className="h-0.5 bg-surface">
          <div
            className={cn(
              "h-full transition-[width] duration-1000 [transition-timing-function:steps(4,end)]",
              low ? "bg-warning" : "bg-brand",
            )}
            style={{ width: `${left * 100}%` }}
          />
        </div>
      ) : null}

      {reconnecting ? warning("Reconnecting to the farm phone…") : null}
      {warnings.idle && warnings.idle > now
        ? warning(`The session closes soon without activity (${mmss(warnings.idle - now)}).`)
        : null}
      {warnings.minutes && warnings.minutes > now
        ? warning(`The session ends in ${mmss(warnings.minutes - now)}.`)
        : null}
    </div>
  );
}
