// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useFarmStore } from "@/stores/farmStore";

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Shown on the device panel while a farm phone is connected. */
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

  return (
    <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-xs">
      <div className="flex items-center gap-3">
        <span className="font-medium">Farm · {session.label}</span>
        <span className="text-muted-foreground">{mmss(now - session.startedAt)}</span>
        <span className="text-muted-foreground">{minutesLeft} min left</span>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={installing || session.status !== "active"}
          onClick={() => void pickApk()}
        >
          {installing ? "Installing…" : "Install APK"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void release()}>
          Release
        </Button>
      </div>
      {session.status === "reconnecting" ? (
        <div className="text-amber-500">Reconnecting to the farm phone…</div>
      ) : null}
      {warnings.idle && warnings.idle > now ? (
        <div className="text-amber-500">
          The session closes soon without activity ({mmss(warnings.idle - now)}).
        </div>
      ) : null}
      {warnings.minutes && warnings.minutes > now ? (
        <div className="text-amber-500">The session ends in {mmss(warnings.minutes - now)}.</div>
      ) : null}
    </div>
  );
}
