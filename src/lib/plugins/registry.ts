// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

import type { CatalogItem, InstalledPlugin, RegistryEntry } from "./types";

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const SHA_RE = /^[0-9a-fA-F]{64}$/;

function parseVersion(v: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negative / 0 / positive like a comparator, or null when either is not semver. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const atLeast = (have: string, need: string) => (compareVersions(have, need) ?? -1) >= 0;

function isEntry(e: unknown): e is RegistryEntry {
  if (!e || typeof e !== "object") return false;
  const r = e as Record<string, unknown>;
  const str = (k: string) => typeof r[k] === "string" && (r[k] as string).length > 0;
  return (
    ["id", "name", "repo", "version", "minAppVersion", "url", "sha256"].every(str) &&
    typeof r.description === "string" &&
    ID_RE.test(r.id as string) &&
    compareVersions(r.version as string, "0.0.0") !== null &&
    compareVersions(r.minAppVersion as string, "0.0.0") !== null &&
    (r.url as string).startsWith("https://") &&
    SHA_RE.test(r.sha256 as string)
  );
}

export function parseRegistry(raw: string): RegistryEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("The plugin registry is not valid JSON.");
  }
  const doc = data as { schema?: unknown; plugins?: unknown } | null;
  if (doc?.schema !== undefined && doc.schema !== 1) {
    throw new Error(
      `Unsupported plugin registry schema: ${String(doc.schema)}. Update Maestro Deck.`,
    );
  }
  if (!doc || !Array.isArray(doc.plugins))
    throw new Error("The plugin registry has no plugin list.");
  return doc.plugins
    .filter(isEntry)
    .map((e) => ({ ...e, kind: e.kind === "theme" ? ("theme" as const) : ("plugin" as const) }));
}

export function buildCatalog(
  registry: RegistryEntry[],
  installed: InstalledPlugin[],
  appVersion: string,
): CatalogItem[] {
  const byId = new Map(installed.map((p) => [p.id, p]));
  const items: CatalogItem[] = registry.map((r) => {
    const inst = byId.get(r.id) ?? null;
    const runnable = atLeast(appVersion, r.minAppVersion);
    let status: CatalogItem["status"];
    if (inst?.error) status = "broken";
    else if (inst)
      status =
        runnable && (compareVersions(r.version, inst.version) ?? 0) > 0 ? "update" : "installed";
    else status = runnable ? "available" : "incompatible";
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      registry: r,
      installed: inst,
      status,
      isTheme: r.kind === "theme" || !!inst?.manifest?.theme,
    };
  });
  const listed = new Set(registry.map((r) => r.id));
  for (const inst of installed) {
    if (listed.has(inst.id)) continue;
    items.push({
      id: inst.id,
      name: inst.manifest?.name ?? inst.id,
      description: inst.dev ? "Local development plugin" : "",
      registry: null,
      installed: inst,
      status: inst.error ? "broken" : "installed",
      isTheme: !!inst.manifest?.theme,
    });
  }
  return items;
}
