// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ChevronLeft, ChevronRight, Cloud, Package, Smartphone } from "lucide-react";
import { useState, type ComponentType, type SVGProps } from "react";

import { AndroidLogo, AppleLogo } from "@/components/BrandIcons";
import { CLOUD_ANDROID_DEVICE } from "@/lib/cloudRunner";
import { cn } from "@/lib/utils";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { toast } from "@/stores/toastStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

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
 * Only the Android emulator is wired up. The other two tabs open onto an
 * explicit placeholder rather than an empty list, which would read as "the
 * farm is down".
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
      {platform.id === "android" ? (
        <AndroidEmulatorTab />
      ) : (
        <div className="rounded border border-dashed border-border p-2 text-[11px] leading-snug text-muted-foreground">
          {platform.blurb} Not connected yet — this tab is the UI shell.
        </div>
      )}
    </div>
  );
}

/**
 * The one cloud target wired up. The fleet runs a single emulator profile, so
 * there is one entry rather than a catalogue, plus the app it installs — the
 * cloud has no device with your build already on it, unlike a phone on your desk.
 */
function AndroidEmulatorTab() {
  const target = useCloudTargetStore((s) => s.target);
  const apkPath = useWorkspaceStore((s) => s.cloudApkPath);
  const setApk = useWorkspaceStore((s) => s.setCloudApkPath);
  const selected = target === "android";

  const pickApk = async () => {
    const picked = await openDialog({
      multiple: false,
      filters: [{ name: "Android app", extensions: ["apk"] }],
    });
    if (typeof picked !== "string") return;
    if (!picked.toLowerCase().endsWith(".apk")) {
      // The cloud installs with `adb install`, which cannot take a bundle, and
      // the job would fail after the run had already been charged.
      toast.error("Not an APK", "The cloud emulator installs .apk files only, not .aab bundles.");
      return;
    }
    setApk(picked);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1.5">
        <li>
          <button
            type="button"
            onClick={() =>
              selected
                ? useCloudTargetStore.getState().clear()
                : useCloudTargetStore.getState().select("android")
            }
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
              selected
                ? "border-foreground/30 bg-accent/60"
                : "border-transparent hover:border-border hover:bg-accent/40",
            )}
          >
            <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-xs font-medium">
              {CLOUD_ANDROID_DEVICE}
            </span>
            {selected ? (
              <span className="text-[10px] text-muted-foreground">Run target</span>
            ) : null}
          </button>
        </li>
      </ul>

      <button
        type="button"
        onClick={() => void pickApk()}
        className="flex w-full items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-left text-[11px] transition-colors hover:bg-accent/40"
      >
        <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">
          {apkPath ? (
            apkPath.split(/[\\/]/).pop()
          ) : (
            <span className="text-muted-foreground">Choose the .apk to install</span>
          )}
        </span>
      </button>
    </div>
  );
}
