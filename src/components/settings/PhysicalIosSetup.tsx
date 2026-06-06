// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { ipc, type IosPhysicalSetupStatus } from "@/lib/ipc";

interface Props {
  /** From ToolPathsSettings — bridge binary present. */
  bridgeInstalled: boolean | null;
  /** From ToolPathsSettings — Apple Team ID is non-empty. */
  teamIdSet: boolean;
  /** Trigger the existing auto-install flow. */
  onInstall: () => void;
  installing: boolean;
  /** Bump to force a status re-fetch (e.g. after install / team-id save). */
  refreshKey?: number;
}

function Row({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className={ok ? "text-green-600" : "text-destructive"}>{ok ? "✓" : "✗"}</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

export function PhysicalIosSetup({
  bridgeInstalled,
  teamIdSet,
  onInstall,
  installing,
  refreshKey,
}: Props) {
  const [status, setStatus] = useState<IosPhysicalSetupStatus | null>(null);

  useEffect(() => {
    let alive = true;
    void ipc.iosPhysicalSetupStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);

  // Until the async status probe AND the parent's bridge/team-id load resolve,
  // everything would default to ✗ and flash a false "not installed" state. Show
  // a loading line instead until we actually know.
  const loading = status === null || bridgeInstalled === null;

  const xcode = status?.xcodeInstalled ?? false;
  const is251 = status?.maestroIs251 ?? false;
  const patched = status?.maestroPatched ?? false;
  const bridge = bridgeInstalled === true;
  const allReady = xcode && is251 && patched && bridge && teamIdSet;

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-muted/20 p-3">
      <div className="text-xs font-semibold">Physical iPhone setup</div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking your setup…
        </div>
      )}

      {!loading && (
        <>
          <Row ok={xcode}>
            Xcode installed
            {!xcode && (
              <span className="text-muted-foreground">
                {" "}
                — install full Xcode from the App Store
              </span>
            )}
          </Row>

          <Row ok={is251}>
            maestro 2.5.1
            {!is251 && (
              <span className="text-muted-foreground">
                {" — "}
                {status?.maestroVersion ? `found ${status.maestroVersion}, ` : ""}need 2.5.1
              </span>
            )}
          </Row>

          <Row ok={patched}>
            maestro patched (physical-device driver)
            {!patched && (
              <span className="text-muted-foreground"> — installed by the bridge below</span>
            )}
          </Row>

          <Row ok={bridge}>
            <span className="flex items-center gap-2">
              Driver bridge installed
              {!bridge && (
                <button
                  type="button"
                  disabled={installing}
                  onClick={onInstall}
                  className="rounded bg-primary px-2 py-0.5 text-[11px] font-medium text-primary-foreground disabled:opacity-50"
                >
                  {installing ? "Installing…" : "Install"}
                </button>
              )}
            </span>
          </Row>

          <Row ok={teamIdSet}>
            Apple Team ID set
            {!teamIdSet && <span className="text-muted-foreground"> — fill the field below</span>}
          </Row>

          <div className="mt-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
            <div>
              • On the iPhone: enable Developer Mode (Settings → Privacy &amp; Security → Developer
              Mode) and tap Trust when plugged in.
            </div>
            <div>
              • First connect builds the driver on the device (~10 min); later connects are fast.
            </div>
          </div>

          {allReady && (
            <div className="rounded bg-green-600/10 px-2 py-1 text-[11px] text-green-700">
              Ready — plug in your iPhone and select it.
            </div>
          )}
        </>
      )}
    </div>
  );
}
