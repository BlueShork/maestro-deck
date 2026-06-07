// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Monitor, Moon, Sun } from "lucide-react";

import { SettingsSection, ToggleRow } from "@/components/settings/SettingsPrimitives";
import { cn } from "@/lib/utils";
import { useSettingsStore, type ThemeMode } from "@/stores/settingsStore";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function GeneralSettings() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const inspectKey = useSettingsStore((s) => s.inspectKey);
  const setInspectKey = useSettingsStore((s) => s.setInspectKey);
  const autoSaveEnabled = useSettingsStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useSettingsStore((s) => s.setAutoSaveEnabled);
  const autoCheckUpdatesEnabled = useSettingsStore((s) => s.autoCheckUpdatesEnabled);
  const setAutoCheckUpdatesEnabled = useSettingsStore((s) => s.setAutoCheckUpdatesEnabled);
  const confirmBeforeQuit = useSettingsStore((s) => s.confirmBeforeQuit);
  const setConfirmBeforeQuit = useSettingsStore((s) => s.setConfirmBeforeQuit);

  return (
    <SettingsSection
      title="General"
      description="Theme, editor, and shortcut preferences are saved locally."
    >
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Theme</span>
        <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium transition-colors",
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={active}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <ToggleRow
        label="Auto-save modified flows"
        description="Automatically saves the open YAML 1 second after you stop typing."
        checked={autoSaveEnabled}
        onCheckedChange={setAutoSaveEnabled}
      />

      <ToggleRow
        label="Check for updates on startup"
        description="Silently checks GitHub releases and prompts you when a new version is available."
        checked={autoCheckUpdatesEnabled}
        onCheckedChange={setAutoCheckUpdatesEnabled}
      />

      <ToggleRow
        label="Confirm before quitting"
        description="Asks for confirmation on Cmd+Q / window close so a stray quit doesn't drop a running session."
        checked={confirmBeforeQuit}
        onCheckedChange={setConfirmBeforeQuit}
      />

      <label className="flex items-center justify-between gap-3">
        <span>Inspect shortcut key</span>
        <input
          type="text"
          value={inspectKey}
          maxLength={1}
          onChange={(e) => setInspectKey(e.currentTarget.value.toLowerCase() || "i")}
          className="w-12 rounded border border-border bg-background px-2 py-1 text-center font-mono text-xs"
        />
      </label>
    </SettingsSection>
  );
}
