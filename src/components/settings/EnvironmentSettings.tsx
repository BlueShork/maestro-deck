// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { useEnvStore } from "@/stores/envStore";

const LABELS: Record<string, string> = {
  maestro: "maestro CLI (required: 2.10.0)",
  java: "Java runtime (required: 17+)",
  adb: "adb — Android platform tools",
  xcode: "Xcode — iOS simulators",
};

/** Read-only mirror of the onboarding checks, reachable after the popup is
 *  gone. Deep iOS-specific checks live in Settings → Tools (PhysicalIosSetup). */
export function EnvironmentSettings() {
  const checks = useEnvStore((s) => s.checks);
  const checking = useEnvStore((s) => s.checking);
  const refresh = useEnvStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <div className="text-sm font-semibold">Environment</div>
      <div className="flex flex-col gap-2 rounded border border-border bg-muted/20 p-3">
        {checking && checks.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking your setup…
          </div>
        ) : (
          checks.map((c) => (
            <div key={c.id} className="flex items-start gap-2 text-xs">
              <span
                className={
                  c.status === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                }
              >
                {c.status === "ok" ? "✓" : "✗"}
              </span>
              <span className="flex-1">
                {LABELS[c.id] ?? c.id}
                {c.version ? <span className="text-muted-foreground"> — {c.version}</span> : null}
                {c.status !== "ok" && c.detail ? (
                  <span className="text-muted-foreground"> — {c.detail}</span>
                ) : null}
              </span>
            </div>
          ))
        )}
        <div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={checking}
            className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {checking ? "Checking…" : "Re-check"}
          </button>
        </div>
      </div>
    </div>
  );
}
