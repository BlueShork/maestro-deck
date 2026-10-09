// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { Monitor, Moon, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";

import {
  SettingsRow,
  SettingsSection,
  SettingsSubgroup,
  ToggleRow,
} from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { forcedMode } from "@/lib/colorTheme";
import { usePluginsStore } from "@/stores/pluginsStore";
import { useSettingsStore, type ThemeMode } from "@/stores/settingsStore";
import { useOnboardingStore } from "@/stores/onboardingStore";
import { useTourStore } from "@/stores/tourStore";

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
];

export function GeneralSettings() {
  const navigate = useNavigate();
  const startTour = useTourStore((s) => s.start);
  const startWalkthrough = useOnboardingStore((s) => s.start);

  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const colorTheme = useSettingsStore((s) => s.colorTheme);
  const colorThemeCache = useSettingsStore((s) => s.colorThemeCache);
  const setColorTheme = useSettingsStore((s) => s.setColorTheme);
  const installed = usePluginsStore((s) => s.installed);
  const themes = installed.filter((p) => p.theme && p.manifest);
  const forced = forcedMode(colorThemeCache);
  const autoCheckUpdatesEnabled = useSettingsStore((s) => s.autoCheckUpdatesEnabled);
  const setAutoCheckUpdatesEnabled = useSettingsStore((s) => s.setAutoCheckUpdatesEnabled);
  const confirmBeforeQuit = useSettingsStore((s) => s.confirmBeforeQuit);
  const setConfirmBeforeQuit = useSettingsStore((s) => s.setConfirmBeforeQuit);

  return (
    <SettingsSection
      title="General"
      description="How Maestro Deck looks and behaves as an app. Every preference on these pages is saved on this machine and applies immediately."
    >
      <SettingsSubgroup title="Appearance">
        <SettingsRow
          label="Color theme"
          description="Install more themes from the Plugins marketplace."
        >
          <select
            aria-label="Color theme"
            value={colorTheme ?? ""}
            onChange={(e) => {
              const p = themes.find((t) => t.id === e.target.value);
              setColorTheme(p ? p.id : null, p?.theme ?? null);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">Maestro Deck (default)</option>
            {themes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.manifest!.name}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow
          label="Theme"
          description={
            forced
              ? `This theme is ${forced} only.`
              : "System follows your OS light / dark setting."
          }
        >
          <Segmented
            aria-label="Theme"
            items={THEME_OPTIONS.map(({ value, label, icon: Icon }) => ({
              value,
              label,
              icon: <Icon className="h-3.5 w-3.5" />,
              disabled: forced !== null,
            }))}
            value={forced ?? theme}
            onChange={setTheme}
          />
        </SettingsRow>
      </SettingsSubgroup>

      <SettingsSubgroup title="Startup & quitting">
        <ToggleRow
          label="Check for updates on startup"
          description="Silently checks GitHub releases a few seconds after launch and offers the update when one is available."
          checked={autoCheckUpdatesEnabled}
          onCheckedChange={setAutoCheckUpdatesEnabled}
        />
        <ToggleRow
          label="Confirm before quitting"
          description="Asks before Cmd+Q or closing the window, so a stray quit doesn't stop a running flow."
          checked={confirmBeforeQuit}
          onCheckedChange={setConfirmBeforeQuit}
        />
      </SettingsSubgroup>

      <SettingsSubgroup
        title="Help & onboarding"
        description="Both open on the main workspace, since that's what they walk you through."
      >
        <SettingsRow
          label="Guided tour"
          description="A quick tour of the workspace panels, as shown on first launch."
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              navigate("/");
              startTour();
            }}
          >
            Replay tour
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Hands-on walkthrough"
          description="Installs the sample app, then helps you write a flow and run it, step by step."
        >
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              // It installs apps and writes into the workspace, so it belongs
              // on the main screen rather than over the settings page.
              navigate("/");
              startWalkthrough();
            }}
          >
            Start walkthrough
          </Button>
        </SettingsRow>
      </SettingsSubgroup>
    </SettingsSection>
  );
}
