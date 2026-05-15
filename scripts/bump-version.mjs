#!/usr/bin/env node
// Bumps the project version everywhere it appears and refreshes the BUSL-1.1
// Change Date to today + 4 years (the maximum allowed by the license covenant).
//
// Usage:
//   node scripts/bump-version.mjs <new-version>
//   node scripts/bump-version.mjs 0.4.0
//
// Updates:
//   - package.json
//   - src-tauri/tauri.conf.json
//   - src-tauri/Cargo.toml
//   - LICENSE  (Change Date -> today + 4 years)
//
// Does NOT commit, tag, or push. Run `git diff` to review, then commit + tag manually.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const newVersion = process.argv[2];
if (!newVersion || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
  console.error("Usage: node scripts/bump-version.mjs <semver>");
  console.error("Example: node scripts/bump-version.mjs 0.4.0");
  process.exit(1);
}

const today = new Date();
today.setUTCHours(0, 0, 0, 0);
const changeDate = new Date(today);
changeDate.setUTCFullYear(changeDate.getUTCFullYear() + 4);
const newChangeDate = changeDate.toISOString().slice(0, 10);

function patchFile(relPath, transform) {
  const path = resolve(root, relPath);
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (after === before) {
    console.warn(`  (no change in ${relPath})`);
    return;
  }
  writeFileSync(path, after);
  console.log(`  updated ${relPath}`);
}

console.log(`Bumping version -> ${newVersion}`);
patchFile("package.json", (s) => s.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`));
patchFile("src-tauri/tauri.conf.json", (s) =>
  s.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`),
);
patchFile("src-tauri/Cargo.toml", (s) =>
  s.replace(/^version\s*=\s*"[^"]+"/m, `version = "${newVersion}"`),
);

console.log(`Refreshing BUSL Change Date -> ${newChangeDate}`);
patchFile("LICENSE", (s) =>
  s.replace(/Change Date:(\s+)\d{4}-\d{2}-\d{2}/, `Change Date:$1${newChangeDate}`),
);

console.log("");
console.log("Done. Review with: git diff");
console.log(`Then commit + tag, e.g.:`);
console.log(`  git commit -am "release: v${newVersion}"`);
console.log(`  git tag v${newVersion}`);
console.log(`  git push && git push --tags`);
