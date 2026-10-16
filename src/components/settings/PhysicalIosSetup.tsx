// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Check, Loader2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { SettingsRow, SettingsSubgroup } from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
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

function Row({
  ok,
  label,
  hint,
  action,
}: {
  ok: boolean;
  label: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <SettingsRow
      label={
        <span className="flex items-center gap-2">
          {ok ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <X className="h-3.5 w-3.5 text-destructive" />
          )}
          {label}
        </span>
      }
      description={!ok && hint ? <span className="pl-[22px]">{hint}</span> : undefined}
    >
      {!ok ? action : null}
    </SettingsRow>
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
  const supported = status?.maestroIsSupported ?? false;
  const patched = status?.maestroPatched ?? false;
  const bridge = bridgeInstalled === true;
  // An installed bridge that is too old for this maestro, or a maestro whose
  // patch an update wiped, needs the same fix: reinstall the bridge.
  const bridgeReady = bridge && (status?.bridgeCurrent ?? false) && patched;
  const allReady = xcode && supported && bridgeReady && teamIdSet;

  return (
    <SettingsSubgroup
      title="Setup checklist"
      description="Everything a real iPhone needs, checked live. Fix the ✗ rows from top to bottom."
    >
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Checking your setup…
        </div>
      ) : (
        <>
          <Row
            ok={xcode}
            label="Xcode installed"
            hint="Install the full Xcode from the App Store."
          />
          <Row
            ok={supported}
            label="Maestro 2.10.0"
            hint={`${status?.maestroVersion ? `Found ${status.maestroVersion}; ` : ""}the iPhone bridge patches 2.10.0.`}
          />
          <Row
            ok={patched}
            label="Maestro patched for physical devices"
            hint="Installed together with the driver bridge below."
          />
          <Row
            ok={bridgeReady}
            label={bridge ? "Driver bridge up to date" : "Driver bridge installed"}
            hint={
              bridge
                ? "This bridge doesn't match Maestro 2.10.0. Connecting the iPhone updates it on its own, or update it now (needs network)."
                : "Downloads the bridge, the patched Maestro 2.10.0 jars and the XCTest runner (once, needs network)."
            }
            action={
              <Button size="sm" disabled={installing} onClick={onInstall}>
                {installing ? "Installing…" : bridge ? "Update" : "Install"}
              </Button>
            }
          />
          <Row ok={teamIdSet} label="Apple Team ID set" hint="Fill it in below." />
          <div className="flex flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
            <span>
              On the iPhone: turn on Developer Mode (Settings → Privacy &amp; Security → Developer
              Mode), then tap Trust when you plug it in.
            </span>
            <span>
              The first connection of each iPhone builds the driver (~30 s); later ones take a few
              seconds.
            </span>
          </div>
          {allReady && (
            <div className="bg-success/10 text-xs text-success">
              Ready — plug in your iPhone and pick it in the device list.
            </div>
          )}
        </>
      )}
    </SettingsSubgroup>
  );
}
