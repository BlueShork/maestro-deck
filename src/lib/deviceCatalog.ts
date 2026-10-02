// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { CloudJobPlatform } from "@/lib/cloudJobs";
import { farmDeviceLabel, type FarmDevice } from "@/lib/farmApi";
import type { Device, Platform } from "@/types";

/**
 * Every place a flow can run, in one list: local phones, simulators and
 * emulators, the web target, farm phones (live remote sessions) and the cloud
 * fleets (run targets). The device picker renders this; each entry carries
 * what the UI needs to show it and the payload needed to act on it.
 */

/** Where the device lives. Farm phones are cloud hardware but open a live
 *  session like a local device, so they are their own source. */
export type CatalogSource = "local" | "farm" | "cloud";

export type CatalogKind = "physical" | "simulator" | "web";

/**
 * - connecting: being connected / booted, or a farm session being opened
 * - connected: the live device right now (local or farm session)
 * - target: the cloud fleet the next Run goes to
 * - ready: can be picked straight away
 * - off: a shut-down simulator / emulator — picking it boots it
 * - in_use / offline: a farm phone someone else holds, or one that is down
 */
export type CatalogState =
  | "connecting"
  | "connected"
  | "target"
  | "ready"
  | "off"
  | "in_use"
  | "offline";

export type CatalogEntry = {
  id: string;
  source: CatalogSource;
  kind: CatalogKind;
  platform: Platform;
  name: string;
  /** OS line under the name ("iOS 18.0", "Android 15"…). */
  os: string;
  /** Extra detail: serial, fleet description… */
  detail: string;
  /** iPads and Android tablets, drawn with the wider body. */
  tablet: boolean;
  state: CatalogState;
} & (
  | { source: "local"; device: Device }
  | { source: "farm"; farm: FarmDevice }
  | { source: "cloud"; cloud: CloudJobPlatform }
);

export interface CatalogInput {
  devices: Device[];
  currentSerial: string | null;
  /** The web target is a beta; hidden unless enabled or already connected. */
  webBrowserEnabled: boolean;
  /** Farm and cloud fleets need a Maestro Deck Cloud account. */
  signedIn: boolean;
  farmDevices: FarmDevice[];
  farmSessionDeviceId: string | null;
  /** The farm session is still opening (no screen yet). */
  farmSessionConnecting: boolean;
  /** Serial of the local device a connect is in flight for. */
  pendingConnectSerial: string | null;
  cloudTarget: CloudJobPlatform | null;
}

/** The cloud fleets, one per worker: android-physical-worker (device farm),
 *  android-docker (emulators), ios-worker (simulators on macOS). */
const CLOUD_FLEETS: Array<{
  id: CloudJobPlatform;
  kind: CatalogKind;
  platform: Platform;
  name: string;
  os: string;
  detail: string;
}> = [
  {
    id: "android_physical",
    kind: "physical",
    platform: "android",
    name: "Android phone",
    os: "Android",
    detail: "Whichever farm phone is free runs the flow",
  },
  {
    id: "android",
    kind: "simulator",
    platform: "android",
    name: "Android emulator",
    os: "Galaxy S10 · Android 14",
    detail: "Started on demand for each run",
  },
  {
    id: "ios",
    kind: "simulator",
    platform: "ios",
    name: "iOS Simulator",
    os: "Hosted macOS runner",
    detail: "Installs a zipped .app simulator build",
  },
];

const isTabletName = (name: string) => /\b(ipad|tablet|tab)\b/i.test(name);

const STATE_RANK: Record<CatalogState, number> = {
  connecting: 0,
  connected: 0,
  target: 0,
  ready: 1,
  off: 2,
  in_use: 3,
  offline: 4,
};
const SOURCE_RANK: Record<CatalogSource, number> = { local: 0, farm: 1, cloud: 2 };

function localEntry(
  d: Device,
  currentSerial: string | null,
  pendingSerial: string | null,
): CatalogEntry {
  const kind: CatalogKind = d.platform === "web" ? "web" : d.physical ? "physical" : "simulator";
  // Shut-down AVDs come back as synthetic `avd:` serials; shut-down iOS
  // simulators as booted=false. A physical iPhone also reports booted=false
  // but is plugged in, so it is never "off".
  const off = d.serial.startsWith("avd:") || (d.platform === "ios" && !d.booted && !d.physical);
  const os =
    d.platform === "web"
      ? "Chromium"
      : d.platform === "ios"
        ? `iOS ${d.os_version}`
        : d.os_version
          ? `Android ${d.os_version}`
          : "Android";
  return {
    id: `local:${d.serial}`,
    source: "local",
    kind,
    platform: d.platform,
    name: d.model,
    os,
    detail: d.serial.startsWith("avd:") ? d.serial.slice(4) : d.serial,
    tablet: isTabletName(d.model),
    state:
      currentSerial === d.serial
        ? "connected"
        : pendingSerial === d.serial
          ? "connecting"
          : off
            ? "off"
            : "ready",
    device: d,
  };
}

function farmEntry(
  f: FarmDevice,
  sessionDeviceId: string | null,
  sessionConnecting: boolean,
): CatalogEntry {
  return {
    id: `farm:${f.id}`,
    source: "farm",
    kind: "physical",
    platform: "android",
    name: farmDeviceLabel(f),
    os: `Android ${f.androidRelease ?? "?"}`,
    detail: [f.manufacturer, f.model].filter(Boolean).join(" "),
    tablet: isTabletName(farmDeviceLabel(f)),
    state:
      sessionDeviceId === f.id
        ? sessionConnecting
          ? "connecting"
          : "connected"
        : f.state === "available"
          ? "ready"
          : f.state === "in_use"
            ? "in_use"
            : "offline",
    farm: f,
  };
}

export function buildCatalog(input: CatalogInput): CatalogEntry[] {
  const local = input.devices
    .filter(
      (d) => d.platform !== "web" || input.webBrowserEnabled || input.currentSerial === d.serial,
    )
    .map((d) => localEntry(d, input.currentSerial, input.pendingConnectSerial));

  const remote: CatalogEntry[] = input.signedIn
    ? [
        ...input.farmDevices.map((f) =>
          farmEntry(f, input.farmSessionDeviceId, input.farmSessionConnecting),
        ),
        ...CLOUD_FLEETS.map(
          (c): CatalogEntry => ({
            ...c,
            id: `cloud:${c.id}`,
            tablet: false,
            source: "cloud",
            state: input.cloudTarget === c.id ? "target" : "ready",
            cloud: c.id,
          }),
        ),
      ]
    : [];

  return [...local, ...remote].sort(
    (a, b) =>
      STATE_RANK[a.state] - STATE_RANK[b.state] ||
      SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
      a.name.localeCompare(b.name) ||
      a.os.localeCompare(b.os, undefined, { numeric: true }),
  );
}

export interface CatalogFilter {
  /** "cloud" covers both the farm and the cloud fleets. */
  source: "all" | "local" | "cloud";
  kind: "all" | CatalogKind;
  query: string;
}

export function filterCatalog(entries: CatalogEntry[], f: CatalogFilter): CatalogEntry[] {
  const q = f.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (f.source === "local" && e.source !== "local") return false;
    if (f.source === "cloud" && e.source === "local") return false;
    if (f.kind !== "all" && e.kind !== f.kind) return false;
    if (!q) return true;
    return [e.name, e.os, e.detail].some((s) => s.toLowerCase().includes(q));
  });
}
