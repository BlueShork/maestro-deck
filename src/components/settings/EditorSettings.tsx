// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import {
  SettingsField,
  SettingsRow,
  SettingsSection,
  SettingsSubgroup,
  ToggleRow,
  settingsInputClass,
} from "@/components/settings/SettingsPrimitives";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settingsStore";

export function EditorSettings() {
  const autoSaveEnabled = useSettingsStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useSettingsStore((s) => s.setAutoSaveEnabled);
  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const setInspectKey = useSettingsStore((s) => s.setInspectKey);
  const appId = useSettingsStore((s) => s.appId);
  const setAppId = useSettingsStore((s) => s.setAppId);

  return (
    <SettingsSection
      title="Editor & Flows"
      description="How the YAML editor saves your work, and what every local run passes to Maestro."
    >
      <SettingsSubgroup title="Editor">
        <ToggleRow
          label="Auto-save modified flows"
          description="Saves the open YAML file 1 second after you stop typing. When off, save with Cmd+S."
          checked={autoSaveEnabled}
          onCheckedChange={setAutoSaveEnabled}
        />
        <SettingsRow
          label="Inspect shortcut key"
          description="Press this key on the device view to toggle inspect mode and pick elements."
        >
          <input
            type="text"
            value={inspectKey}
            maxLength={1}
            aria-label="Inspect shortcut key"
            onChange={(e) => setInspectKey(e.currentTarget.value.toLowerCase() || "i")}
            className={cn(settingsInputClass, "w-12 text-center")}
          />
        </SettingsRow>
      </SettingsSubgroup>

      <SettingsSubgroup title="Runs">
        <SettingsField
          label="App ID"
          htmlFor="settings-app-id"
          description={
            <>
              Passed to Maestro as <code className="font-mono">-e APP_ID=…</code> on every local
              run, so flows that use <code className="font-mono">{"${APP_ID}"}</code> (like your CI
              flows) run here without editing each file. Leave empty to pass nothing.
            </>
          }
        >
          <input
            id="settings-app-id"
            type="text"
            value={appId}
            placeholder="com.example.app"
            onChange={(e) => setAppId(e.currentTarget.value)}
            className={settingsInputClass}
          />
        </SettingsField>
      </SettingsSubgroup>
    </SettingsSection>
  );
}
