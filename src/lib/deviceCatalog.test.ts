// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { buildCatalog, filterCatalog, type CatalogInput } from "@/lib/deviceCatalog";
import type { Device } from "@/types";
import type { FarmDevice } from "@/lib/farmApi";

const dev = (over: Partial<Device>): Device => ({
  serial: "s",
  model: "Model",
  android_version: "",
  screen_width: 1080,
  screen_height: 2400,
  platform: "android",
  os_version: "15",
  booted: true,
  physical: true,
  ...over,
});

const farm = (over: Partial<FarmDevice>): FarmDevice => ({
  id: "f1",
  manufacturer: "samsung",
  model: "SM-S928B",
  marketingName: null,
  androidRelease: "15",
  sdk: 35,
  screen: null,
  state: "available",
  ...over,
});

const base: CatalogInput = {
  devices: [],
  currentSerial: null,
  webBrowserEnabled: true,
  signedIn: false,
  farmDevices: [],
  farmSessionDeviceId: null,
  cloudTarget: null,
};

describe("buildCatalog", () => {
  it("classifies local phones, simulators, emulators and the web target", () => {
    const entries = buildCatalog({
      ...base,
      devices: [
        dev({ serial: "R5C", model: "SM-S911B", physical: true }),
        dev({ serial: "emulator-5554", model: "Pixel 8", physical: false }),
        dev({ serial: "avd:Pixel_9", model: "Pixel 9", physical: false, booted: false }),
        dev({
          serial: "SIM-1",
          model: "iPhone 16",
          platform: "ios",
          physical: false,
          booted: false,
        }),
        dev({
          serial: "00008",
          model: "iPhone 15",
          platform: "ios",
          physical: true,
          booted: false,
        }),
        dev({ serial: "web", model: "Web Browser (Chromium)", platform: "web", physical: false }),
      ],
      currentSerial: "R5C",
    });
    const by = (id: string) => entries.find((e) => e.id === id)!;
    expect(by("local:R5C")).toMatchObject({
      source: "local",
      kind: "physical",
      state: "connected",
    });
    expect(by("local:emulator-5554")).toMatchObject({ kind: "simulator", state: "ready" });
    expect(by("local:avd:Pixel_9")).toMatchObject({ kind: "simulator", state: "off" });
    expect(by("local:SIM-1")).toMatchObject({ kind: "simulator", platform: "ios", state: "off" });
    // A physical iPhone reports booted=false but is plugged in and usable.
    expect(by("local:00008")).toMatchObject({ kind: "physical", state: "ready" });
    expect(by("local:web")).toMatchObject({ kind: "web", platform: "web" });
  });

  it("hides the web target unless the beta is on or it is the connected device", () => {
    const web = dev({ serial: "web", platform: "web", physical: false });
    expect(buildCatalog({ ...base, devices: [web], webBrowserEnabled: false })).toHaveLength(0);
    expect(
      buildCatalog({ ...base, devices: [web], webBrowserEnabled: false, currentSerial: "web" }),
    ).toHaveLength(1);
  });

  it("lists farm phones and cloud fleets only when signed in", () => {
    const signedOut = buildCatalog({ ...base, farmDevices: [farm({})] });
    expect(signedOut.filter((e) => e.source !== "local")).toHaveLength(0);

    const entries = buildCatalog({
      ...base,
      signedIn: true,
      farmDevices: [
        farm({ id: "a" }),
        farm({ id: "b", state: "in_use" }),
        farm({ id: "c", state: "offline" }),
      ],
      farmSessionDeviceId: "a",
      cloudTarget: "ios",
    });
    const by = (id: string) => entries.find((e) => e.id === id)!;
    expect(by("farm:a")).toMatchObject({ source: "farm", kind: "physical", state: "connected" });
    expect(by("farm:b").state).toBe("in_use");
    expect(by("farm:c").state).toBe("offline");
    expect(by("cloud:ios")).toMatchObject({ source: "cloud", platform: "ios", state: "target" });
    expect(by("cloud:android")).toMatchObject({ kind: "simulator", state: "ready" });
    expect(by("cloud:android_physical")).toMatchObject({ kind: "physical", platform: "android" });
  });

  it("puts what is in use first, then usable entries, then the rest", () => {
    const entries = buildCatalog({
      ...base,
      devices: [
        dev({ serial: "avd:A", model: "A", physical: false, booted: false }),
        dev({ serial: "B", model: "B" }),
        dev({ serial: "C", model: "C" }),
      ],
      currentSerial: "C",
    });
    expect(entries.map((e) => e.id)).toEqual(["local:C", "local:B", "local:avd:A"]);
  });
});

describe("tablets", () => {
  it("flags iPads and Android tablets", () => {
    const entries = buildCatalog({
      ...base,
      devices: [
        dev({ serial: "a", model: 'iPad Air 13"', platform: "ios", physical: false }),
        dev({ serial: "b", model: "Galaxy Tab S9" }),
        dev({ serial: "c", model: "Pixel 8" }),
      ],
    });
    expect(entries.map((e) => [e.name, e.tablet])).toEqual([
      ["Galaxy Tab S9", true],
      ['iPad Air 13"', true],
      ["Pixel 8", false],
    ]);
  });
});

describe("filterCatalog", () => {
  const entries = buildCatalog({
    ...base,
    signedIn: true,
    devices: [
      dev({ serial: "R5C", model: "SM-S911B" }),
      dev({ serial: "SIM-1", model: "iPhone 16 Pro", platform: "ios", physical: false }),
    ],
    farmDevices: [farm({ id: "a", marketingName: "Galaxy S24 Ultra" })],
  });

  it("filters by source and kind", () => {
    expect(filterCatalog(entries, { source: "local", kind: "all", query: "" })).toHaveLength(2);
    expect(
      filterCatalog(entries, { source: "all", kind: "physical", query: "" }).map((e) => e.id),
    ).toEqual(["local:R5C", "farm:a", "cloud:android_physical"]);
    expect(filterCatalog(entries, { source: "cloud", kind: "all", query: "" })).toHaveLength(4);
  });

  it("searches names, OS and serials, case-insensitively", () => {
    expect(filterCatalog(entries, { source: "all", kind: "all", query: "galaxy" })[0].id).toBe(
      "farm:a",
    );
    expect(filterCatalog(entries, { source: "all", kind: "all", query: "r5c" })[0].id).toBe(
      "local:R5C",
    );
    expect(filterCatalog(entries, { source: "all", kind: "all", query: "ios" }).length).toBe(2);
  });
});
