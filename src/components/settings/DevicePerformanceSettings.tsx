// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  SettingsBadge,
  SettingsSection,
  SettingsSubgroup,
  ToggleRow,
} from "@/components/settings/SettingsPrimitives";
import { useSettingsStore } from "@/stores/settingsStore";

export function DevicePerformanceSettings() {
  const streamEnabled = useSettingsStore((s) => s.streamEnabled);
  const setStreamEnabled = useSettingsStore((s) => s.setStreamEnabled);
  const fastHierarchyEnabled = useSettingsStore((s) => s.fastHierarchyEnabled);
  const setFastHierarchyEnabled = useSettingsStore((s) => s.setFastHierarchyEnabled);
  const webBrowserEnabled = useSettingsStore((s) => s.webBrowserEnabled);
  const setWebBrowserEnabled = useSettingsStore((s) => s.setWebBrowserEnabled);

  return (
    <SettingsSection
      title="Devices & Performance"
      description="How devices are mirrored, how fast the inspector reads their screen, and which kinds of targets show up in the device list. Trade a feature for speed here if your machine is struggling."
    >
      <SettingsSubgroup title="Mirroring">
        <ToggleRow
          label="Live device stream"
          description="Mirrors the connected device's screen in the app. Turn it off to run flows without the mirror — saves about 250 MB of RAM and 10% CPU. Applies to the connected device right away."
          checked={streamEnabled}
          onCheckedChange={setStreamEnabled}
        />
      </SettingsSubgroup>

      <SettingsSubgroup title="Inspector">
        <ToggleRow
          label={
            <>
              Fast hierarchy
              <SettingsBadge>experimental</SettingsBadge>
            </>
          }
          description={
            <>
              Keeps a <code className="font-mono">maestro mcp</code> process warm in the background
              and talks to the on-device driver directly. The first inspect takes ~15 s, then each
              one drops from ~11 s to under 1 s. Falls back to the slower CLI if the helper fails.
            </>
          }
          checked={fastHierarchyEnabled}
          onCheckedChange={setFastHierarchyEnabled}
        />
      </SettingsSubgroup>

      <SettingsSubgroup title="Device list">
        <ToggleRow
          label={
            <>
              Web browser target
              <SettingsBadge>beta</SettingsBadge>
            </>
          }
          description="Adds a Chromium browser to the device list so you can write and run web flows. Runs headless with a live view in the app."
          checked={webBrowserEnabled}
          onCheckedChange={setWebBrowserEnabled}
        />
      </SettingsSubgroup>
    </SettingsSection>
  );
}
