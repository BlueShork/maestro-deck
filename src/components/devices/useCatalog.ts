// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { useMemo } from "react";

import { pickCloudArtifact } from "@/lib/cloudArtifact";
import { cloudAppPath } from "@/lib/cloudRunner";
import { buildCatalog, type CatalogEntry } from "@/lib/deviceCatalog";
import { useCloudAuthStore } from "@/stores/cloudAuthStore";
import { useCloudTargetStore } from "@/stores/cloudTargetStore";
import { useDeviceStore } from "@/stores/deviceStore";
import { useFarmStore } from "@/stores/farmStore";
import { useSettingsStore } from "@/stores/settingsStore";

/** The device catalog, rebuilt only when one of its inputs changes. */
export function useCatalog(): CatalogEntry[] {
  const devices = useDeviceStore((s) => s.devices);
  const currentSerial = useDeviceStore((s) => s.current?.serial ?? null);
  const webBrowserEnabled = useSettingsStore((s) => s.webBrowserEnabled);
  const signedIn = useCloudAuthStore((s) => s.user !== null);
  const farmDevices = useFarmStore((s) => s.devices);
  const farmSessionDeviceId = useFarmStore((s) => s.session?.deviceId ?? null);
  const farmSessionConnecting = useFarmStore((s) => s.session?.status === "connecting");
  const pendingConnectSerial = useDeviceStore((s) =>
    s.pendingAction === "connect" ? s.pendingSerial : null,
  );
  const cloudTarget = useCloudTargetStore((s) => s.target);

  return useMemo(
    () =>
      buildCatalog({
        devices,
        currentSerial,
        webBrowserEnabled,
        signedIn,
        farmDevices,
        farmSessionDeviceId,
        farmSessionConnecting,
        pendingConnectSerial,
        cloudTarget,
      }),
    [
      devices,
      currentSerial,
      webBrowserEnabled,
      signedIn,
      farmDevices,
      farmSessionDeviceId,
      farmSessionConnecting,
      pendingConnectSerial,
      cloudTarget,
    ],
  );
}

/** Whether an entry can be picked right now. */
export function isSelectable(e: CatalogEntry): boolean {
  return e.state !== "in_use" && e.state !== "offline";
}

/**
 * Pick an entry: connect a local device (booting it if it is shut down), open
 * a farm session, or make a cloud fleet the run target — asking for its build
 * first when none is chosen. Picking the entry already in use releases it.
 * Resolves to true when the pick went through.
 */
export async function selectEntry(e: CatalogEntry): Promise<boolean> {
  switch (e.source) {
    case "local": {
      const store = useDeviceStore.getState();
      if (e.state === "connecting") return false;
      if (e.state === "connected") {
        await store.disconnect();
        return true;
      }
      // A run target in the cloud and a live local device are exclusive in
      // the UI: picking a device here means "run here".
      useCloudTargetStore.getState().clear();
      void store.connect(e.device.serial);
      return true;
    }
    case "farm": {
      const farm = useFarmStore.getState();
      // Releasing while the session opens cancels it (farmStore handles it).
      if (e.state === "connected" || e.state === "connecting") {
        await farm.release();
        return true;
      }
      if (!isSelectable(e)) return false;
      useCloudTargetStore.getState().clear();
      void farm.connect(e.farm);
      return true;
    }
    case "cloud": {
      const target = useCloudTargetStore.getState();
      if (e.state === "target") {
        target.clear();
        return true;
      }
      if (!cloudAppPath(e.cloud) && !(await pickCloudArtifact(e.cloud))) return false;
      target.select(e.cloud);
      return true;
    }
  }
}

/** What clicking an entry does, as a short verb for its call to action. */
export function actionLabel(e: CatalogEntry): string {
  switch (e.state) {
    case "connecting":
      return e.source === "farm" ? "Cancel" : "Connecting…";
    case "connected":
      return e.source === "farm" ? "Release" : "Disconnect";
    case "target":
      return "Clear target";
    case "off":
      return e.platform === "ios" ? "Boot & connect" : "Start & connect";
    case "in_use":
      return "In use";
    case "offline":
      return "Offline";
    case "ready":
      return e.source === "cloud" ? "Run here" : "Connect";
  }
}

/** What is happening while an entry connects, so the wait never looks frozen. */
export function connectingHint(e: CatalogEntry): string {
  if (e.source === "farm")
    return "Opening a session on the device farm — this can take up to a minute.";
  if (e.kind === "simulator") {
    return e.platform === "ios"
      ? "Booting the simulator and starting the driver — about a minute the first time."
      : "Starting the emulator — a minute or two from a cold boot.";
  }
  if (e.platform === "ios") return "Starting the driver on your iPhone — keep it unlocked.";
  return "Starting the mirror and the Maestro driver…";
}

/** The entry being connected right now, if any. */
export function useConnectingEntry(): CatalogEntry | null {
  return useCatalog().find((e) => e.state === "connecting") ?? null;
}
