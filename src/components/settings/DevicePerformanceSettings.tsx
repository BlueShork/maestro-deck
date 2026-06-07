// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { SettingsSection, ToggleRow } from "@/components/settings/SettingsPrimitives";
import { useSettingsStore } from "@/stores/settingsStore";

export function DevicePerformanceSettings() {
  const streamEnabled = useSettingsStore((s) => s.streamEnabled);
  const setStreamEnabled = useSettingsStore((s) => s.setStreamEnabled);
  const perfMonitoringEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const setPerfMonitoringEnabled = useSettingsStore((s) => s.setPerfMonitoringEnabled);
  const fastHierarchyEnabled = useSettingsStore((s) => s.fastHierarchyEnabled);
  const setFastHierarchyEnabled = useSettingsStore((s) => s.setFastHierarchyEnabled);

  return (
    <SettingsSection
      title="Device & Performance"
      description="Control how the app mirrors devices and inspects their UI hierarchy."
    >
      <ToggleRow
        label="Live device stream"
        description="Off = run flows on a connected device without scrcpy mirroring. Saves ~250 MB RAM and ~10% CPU."
        checked={streamEnabled}
        onCheckedChange={setStreamEnabled}
      />

      <ToggleRow
        label="Enable performance monitoring"
        description="Adds a performance HUD next to the console."
        checked={perfMonitoringEnabled}
        onCheckedChange={setPerfMonitoringEnabled}
      />

      <ToggleRow
        label={
          <>
            Fast hierarchy{" "}
            <span className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
              experimental
            </span>
          </>
        }
        description={
          <>
            Keeps a <code className="font-mono">maestro studio</code> process warm in background and
            talks gRPC directly to the on-device driver. First inspect takes ~15 s, subsequent dumps
            drop from ~11 s to &lt;1 s. Falls back to the CLI path if studio fails.
          </>
        }
        checked={fastHierarchyEnabled}
        onCheckedChange={setFastHierarchyEnabled}
      />
    </SettingsSection>
  );
}
