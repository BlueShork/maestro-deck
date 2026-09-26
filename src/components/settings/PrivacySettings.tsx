// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink } from "lucide-react";

import {
  SettingsRow,
  SettingsSection,
  SettingsSubgroup,
  ToggleRow,
} from "@/components/settings/SettingsPrimitives";
import { Button } from "@/components/ui/Button";
import { COOKIES_URL, PRIVACY_URL } from "@/lib/telemetry";
import { useTelemetryStore } from "@/stores/telemetryStore";

export function PrivacySettings() {
  const enabled = useTelemetryStore((s) => s.consent === "granted");
  const setConsent = useTelemetryStore((s) => s.setConsent);

  return (
    <SettingsSection
      title="Privacy"
      description="Maestro Deck runs on your machine: your flows, files and devices never leave it unless you run on Maestro Deck Cloud or talk to Billy. The only other thing it can send is the optional statistics below."
    >
      <SettingsSubgroup
        title="Usage statistics"
        description="They tell us how many people use Maestro Deck, on which platforms, and which features matter — so we know what to build next. Never used for tracking or advertising, never sold or shared."
      >
        <ToggleRow
          label="Share anonymous usage statistics"
          description="Processed by PostHog on servers in the EU. Turning this off stops all sending and deletes the random install ID."
          checked={enabled}
          onCheckedChange={setConsent}
        />
        <div className="grid gap-4 text-xs sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <span className="font-medium">Collected</span>
            <span className="leading-relaxed text-muted-foreground">
              App version, operating system, a random install ID, screens opened, and feature usage:
              device platform, runs (passed / failed / stopped), inspector, Billy, cloud runs,
              screenshot bank.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-medium">Never collected</span>
            <span className="leading-relaxed text-muted-foreground">
              Flow contents, file paths, selectors, app IDs, screenshots, device names or serials,
              prompts or anything you type, your name, email or account.
            </span>
          </div>
        </div>
      </SettingsSubgroup>

      <SettingsSubgroup title="Policies">
        <SettingsRow label="Privacy policy" description="What is processed, why, and your rights.">
          <Button size="sm" variant="outline" onClick={() => void openUrl(PRIVACY_URL)}>
            Open <ExternalLink className="h-3 w-3" />
          </Button>
        </SettingsRow>
        <SettingsRow label="Cookie policy" description="Analytics on maestrodeck.cloud.">
          <Button size="sm" variant="outline" onClick={() => void openUrl(COOKIES_URL)}>
            Open <ExternalLink className="h-3 w-3" />
          </Button>
        </SettingsRow>
      </SettingsSubgroup>
    </SettingsSection>
  );
}
