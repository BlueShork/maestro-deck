// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { ChevronLeft, ChevronRight, Smartphone } from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";

import { AndroidLogo, AppleLogo } from "@/components/BrandIcons";

/**
 * Cloud platforms, keyed by the `platform` value the runner already stores on
 * every job (see dashboard/app/dashboard/page.tsx in maestro-nightly). Each one
 * is served by its own worker: android-physical-worker (device farm),
 * android-docker (emulators), ios-worker (simulators on macOS).
 */
export type CloudPlatform = "android_physical" | "android" | "ios";

const PLATFORMS: {
  id: CloudPlatform;
  // Wide enough for both the hand-rolled brand SVGs and lucide's components.
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  /** Shown in the drill-in, to say what the fleet behind this tab actually is. */
  blurb: string;
}[] = [
  {
    id: "android_physical",
    icon: Smartphone,
    label: "Android Physical",
    blurb: "Real handsets in the device farm.",
  },
  {
    id: "android",
    icon: AndroidLogo,
    label: "Android Simulators",
    blurb: "Emulators started on demand.",
  },
  {
    id: "ios",
    icon: AppleLogo,
    label: "iOS Simulators",
    blurb: "Simulators on hosted macOS runners.",
  },
];

/**
 * The CLOUD DEVICES area: same drill-in shape as SIMULATORS, so running in the
 * cloud reads as one more place to pick a device rather than a separate mode.
 *
 * UI shell only for now — nothing here talks to the cloud yet, so each tab
 * opens onto an explicit placeholder instead of an empty list that would read
 * as "the farm is down".
 */
export function CloudDevicesSection() {
  const [view, setView] = useState<CloudPlatform | null>(null);

  if (view === null) {
    return (
      <div
        key="root"
        className="flex flex-col gap-1.5 overflow-x-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-4 motion-safe:duration-200"
      >
        <ul className="flex flex-col gap-1.5">
          {PLATFORMS.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setView(p.id)}
                className="group flex w-full items-center gap-2 rounded-md border border-transparent px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-accent/40"
              >
                <p.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{p.label}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const platform = PLATFORMS.find((p) => p.id === view);
  if (!platform) return null;

  return (
    <div
      key={view}
      className="flex flex-col gap-1.5 overflow-x-hidden motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-right-4 motion-safe:duration-200"
    >
      <button
        type="button"
        onClick={() => setView(null)}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        {platform.label}
      </button>
      <div className="rounded border border-dashed border-border p-2 text-[11px] leading-snug text-muted-foreground">
        {platform.blurb} Not connected yet — this tab is the UI shell.
      </div>
    </div>
  );
}
