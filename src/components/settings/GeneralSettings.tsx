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
import { cn } from "@/lib/utils";
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
        <SettingsRow label="Theme" description="System follows your OS light / dark setting.">
          <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
