#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const [rawVersion, manifestPath] = process.argv.slice(2);
if (!rawVersion) {
  console.error("usage: release-notes.mjs <version> [latest.json]");
  process.exit(1);
}
const version = rawVersion.replace(/^v/, "");

const here = dirname(fileURLToPath(import.meta.url));
const changelog = readFileSync(resolve(here, "..", "CHANGELOG_EN.md"), "utf8");

const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const heading = new RegExp(`^# What's New in v${escaped}\\s*$`, "m");
const start = changelog.match(heading);
if (!start) {
  console.error(`::error::No "# What's New in v${version}" section in CHANGELOG_EN.md`);
  process.exit(1);
}

const rest = changelog.slice(start.index + start[0].length);
const end = rest.search(/^(---\s*$|# )/m);
const notes = (end === -1 ? rest : rest.slice(0, end)).trim();
if (!notes) {
  console.error(`::error::The v${version} section of CHANGELOG_EN.md is empty`);
  process.exit(1);
}

if (!manifestPath) {
  process.stdout.write(notes + "\n");
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.notes = notes;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote v${version} notes into ${manifestPath}`);
}
