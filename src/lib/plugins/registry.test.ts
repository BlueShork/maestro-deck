// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import { describe, expect, it } from "vitest";

import { buildCatalog, compareVersions, parseRegistry } from "./registry";
import type { InstalledPlugin, RegistryEntry } from "./types";

const entry = (over: Partial<RegistryEntry> = {}): RegistryEntry => ({
  id: "jira",
  name: "Jira",
  description: "Create issues",
  repo: "BlueShork/maestro-deck-plugin-jira",
  version: "1.0.0",
  minAppVersion: "1.1.0",
  url: "https://github.com/x/plugin.zip",
  sha256: "a".repeat(64),
  ...over,
});

const installed = (over: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id: "jira",
  version: "1.0.0",
  dev: false,
  manifest: {
    id: "jira",
    name: "Jira",
    version: "1.0.0",
    minAppVersion: "1.1.0",
    entry: "index.html",
    permissions: { http: [], open: [], secrets: true },
  },
  error: null,
  ...over,
});

describe("compareVersions", () => {
  it("orders numerically and ignores pre-release tags", () => {
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta")).toBe(0);
    expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    expect(compareVersions("x", "1.0.0")).toBeNull();
  });
});

describe("parseRegistry", () => {
  it("keeps valid entries and drops malformed ones", () => {
    const raw = JSON.stringify({
      schema: 1,
      plugins: [entry(), { id: "bad" }, entry({ id: "Nope" })],
    });
    expect(parseRegistry(raw).map((e) => e.id)).toEqual(["jira"]);
  });
  it("throws on unreadable or unknown-schema registries", () => {
    expect(() => parseRegistry("{")).toThrow(/registry/i);
    expect(() => parseRegistry(JSON.stringify({ schema: 2, plugins: [] }))).toThrow(/schema/i);
    expect(() => parseRegistry(JSON.stringify({ schema: 1 }))).toThrow(/registry/i);
  });
  it("drops entries whose url is not https or sha256 is not 64 hex chars", () => {
    const raw = JSON.stringify({
      schema: 1,
      plugins: [entry({ url: "http://x" }), entry({ id: "b", sha256: "zz" })],
    });
    expect(parseRegistry(raw)).toEqual([]);
  });
});

describe("buildCatalog", () => {
  it("marks available, installed, update, incompatible and broken", () => {
    expect(buildCatalog([entry()], [], "1.1.0")[0].status).toBe("available");
    expect(buildCatalog([entry()], [installed()], "1.1.0")[0].status).toBe("installed");
    expect(buildCatalog([entry({ version: "1.1.0" })], [installed()], "1.1.0")[0].status).toBe(
      "update",
    );
    expect(buildCatalog([entry({ minAppVersion: "9.0.0" })], [], "1.1.0")[0].status).toBe(
      "incompatible",
    );
    expect(
      buildCatalog([entry()], [installed({ manifest: null, error: "boom" })], "1.1.0")[0].status,
    ).toBe("broken");
  });
  it("does not offer an update the app cannot run", () => {
    const item = buildCatalog(
      [entry({ version: "2.0.0", minAppVersion: "9.0.0" })],
      [installed()],
      "1.1.0",
    )[0];
    expect(item.status).toBe("installed");
  });
  it("lists installed plugins missing from the registry after the registry ones", () => {
    const items = buildCatalog([entry({ id: "linear", name: "Linear" })], [installed()], "1.1.0");
    expect(items.map((i) => [i.id, i.status])).toEqual([
      ["linear", "available"],
      ["jira", "installed"],
    ]);
    expect(items[1].name).toBe("Jira");
  });
});

describe("theme kind", () => {
  const base = {
    id: "catppuccin",
    name: "Catppuccin",
    description: "Soothing pastel theme",
    repo: "BlueShork/maestro-deck-plugin-catppuccin",
    version: "1.0.0",
    minAppVersion: "1.3.0",
    url: "https://example.com/plugin.zip",
    sha256: "a".repeat(64),
  };

  it("keeps kind theme and drops unknown kinds to plugin", () => {
    const [t, p] = parseRegistry(
      JSON.stringify({
        plugins: [
          { ...base, kind: "theme" },
          { ...base, id: "x", kind: "font" },
        ],
      }),
    );
    expect(t.kind).toBe("theme");
    expect(p.kind).toBe("plugin");
  });

  it("flags catalog items as themes from the registry or the installed manifest", () => {
    const [entry] = parseRegistry(JSON.stringify({ plugins: [{ ...base, kind: "theme" }] }));
    expect(buildCatalog([entry], [], "1.3.0")[0].isTheme).toBe(true);
    const local = {
      id: "dev-theme",
      version: "0.1.0",
      dev: true,
      error: null,
      manifest: {
        id: "dev-theme",
        name: "Dev",
        version: "0.1.0",
        minAppVersion: "1.3.0",
        theme: "theme.json",
        permissions: { http: [], open: [], secrets: false },
      },
    };
    expect(buildCatalog([], [local], "1.3.0")[0].isTheme).toBe(true);
  });
});
