// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";

import {
  SettingsRow,
  SettingsSection,
  SettingsSubgroup,
} from "@/components/settings/SettingsPrimitives";
import { ToolPathField, ToolPathsSaveBar } from "@/components/settings/ToolPathFields";
import { useToolPaths } from "@/components/settings/useToolPaths";
import { Button } from "@/components/ui/Button";
import { useEnvStore } from "@/stores/envStore";

const LABELS: Record<string, { name: string; what: string }> = {
  maestro: { name: "Maestro CLI", what: "Runs your flows · required: 2.10.0" },
  java: { name: "Java runtime", what: "Needed by Maestro · required: 17+" },
  adb: { name: "adb", what: "Android platform tools · Android devices and emulators" },
  xcode: { name: "Xcode", what: "iOS simulators · macOS only" },
};

export function ToolchainSettings() {
  const checks = useEnvStore((s) => s.checks);
  const checking = useEnvStore((s) => s.checking);
  const refresh = useEnvStore((s) => s.refresh);
  const paths = useToolPaths();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <SettingsSection
      title="Toolchain"
      description="Maestro Deck drives your devices through a few command-line tools. On first launch it installs Java, the Maestro CLI and adb in its own folder, so most people never need this page — come here if something shows a ✗ or you'd rather use your own installs."
    >
      <SettingsSubgroup title="Status">
        {checking && checks.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking your setup…
          </div>
        ) : (
          checks.map((c) => {
            const ok = c.status === "ok";
            const label = LABELS[c.id];
            return (
              <SettingsRow
                key={c.id}
                label={
                  <span className="flex items-center gap-2">
                    {ok ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <X className="h-3.5 w-3.5 text-destructive" />
                    )}
                    {label?.name ?? c.id}
                  </span>
                }
                description={
                  <span className="pl-[22px]">
                    {label?.what}
                    {!ok && c.detail ? ` — ${c.detail}` : ""}
                  </span>
                }
              >
                <span className="font-mono text-[11px] text-muted-foreground">
                  {c.version ?? (ok ? "" : "missing")}
                </span>
              </SettingsRow>
            );
          })
        )}
        <SettingsRow label="Check again" description="Run the checks after installing something.">
          <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={checking}>
            <RefreshCw className={checking ? "h-3 w-3 animate-spin" : "h-3 w-3"} />
            {checking ? "Checking…" : "Re-check"}
          </Button>
        </SettingsRow>
      </SettingsSubgroup>

      <SettingsSubgroup
        title="Custom tool paths"
        description="Only needed when the app can't find a tool on its own — typically on locked-down work machines where apps don't inherit your shell PATH. Leave empty to use automatic detection."
      >
        <ToolPathField
          paths={paths}
          tool="adb"
          label="adb"
          placeholder="/opt/homebrew/bin/adb"
          hint="Android Debug Bridge — usually installed with Android Studio or Homebrew."
        />
        <ToolPathField
          paths={paths}
          tool="maestro"
          label="Maestro CLI"
          placeholder="~/.maestro/bin/maestro"
          hint="The test runner — from the official install script or Homebrew."
        />
        <ToolPathsSaveBar paths={paths} />
      </SettingsSubgroup>
    </SettingsSection>
  );
}
