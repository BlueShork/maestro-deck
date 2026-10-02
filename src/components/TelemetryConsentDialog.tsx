// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { openUrl } from "@tauri-apps/plugin-opener";
import { BarChart3 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/Dialog";
import { COOKIES_URL, PRIVACY_URL, track } from "@/lib/telemetry";
import { useTelemetryStore } from "@/stores/telemetryStore";

const COLLECTED = [
  "App version, operating system and a random install ID",
  "Which screens and features are used — device platform, runs, inspector, Billy, cloud",
  "Whether a run passed, failed or was stopped",
];

const NEVER_COLLECTED = [
  "Your flows, files, selectors, app IDs or screenshots",
  "Device names, serials, prompts or anything you type",
  "Your name, email or Maestro Deck Cloud account",
];

export function TelemetryConsentDialog() {
  const consent = useTelemetryStore((s) => s.consent);
  const setConsent = useTelemetryStore((s) => s.setConsent);

  const decline = () => setConsent(false);
  const accept = () => {
    setConsent(true);
    track("app_opened", {});
  };

  return (
    <Dialog open={consent === null} onOpenChange={(next) => !next && decline()}>
      <DialogContent
        className="max-w-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <span className="mb-3 inline-flex h-10 w-10 items-center justify-center bg-brand text-brand-foreground">
          <BarChart3 className="h-5 w-5" />
        </span>

        <DialogTitle>Help us understand how Maestro Deck is used</DialogTitle>
        <DialogDescription className="mt-1.5">
          Maestro Deck is built by an independent developer. Anonymous usage statistics are the only
          way to know how many people actually use it, on which platforms, and which features matter
          — so we can decide what to build next and keep the project going. They are not used to
          track, profile or advertise to you, and are never sold or shared.
        </DialogDescription>

        <div className="mt-4 grid border-l border-t border-border text-xs sm:grid-cols-2">
          <div className="border-b border-r border-border p-3">
            <div className="mono-label mb-2 text-foreground">What we collect</div>
            <ul className="flex flex-col gap-1.5 text-muted-foreground">
              {COLLECTED.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="step-pip step-pip-done mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="border-b border-r border-border p-3">
            <div className="mono-label mb-2 text-foreground">What we never collect</div>
            <ul className="flex flex-col gap-1.5 text-muted-foreground">
              {NEVER_COLLECTED.map((item) => (
                <li key={item} className="flex gap-2">
                  <span aria-hidden className="step-pip step-pip-failed mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Data is processed by PostHog on servers in the European Union. You can change your choice
          at any time in Settings → Privacy. See our{" "}
          <button
            type="button"
            onClick={() => void openUrl(PRIVACY_URL)}
            className="text-foreground underline decoration-brand underline-offset-[3px] hover:text-brand"
          >
            privacy policy
          </button>{" "}
          and{" "}
          <button
            type="button"
            onClick={() => void openUrl(COOKIES_URL)}
            className="text-foreground underline decoration-brand underline-offset-[3px] hover:text-brand"
          >
            cookie policy
          </button>
          .
        </p>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={decline}>
            No thanks
          </Button>
          <Button size="sm" onClick={accept}>
            Share anonymous statistics
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
