#!/usr/bin/env node
// Verifies the BUSL-1.1 Change Date in LICENSE is valid for a release:
//   - Not in the past (would mean the version is already Apache-2.0)
//   - Not more than 4 years from today (BUSL covenant: 4th-anniversary clause caps it)
// Run from CI before building a release. Exits non-zero on failure.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const licensePath = resolve(here, "..", "LICENSE");
const license = readFileSync(licensePath, "utf8");

const match = license.match(/Change Date:\s+(\d{4}-\d{2}-\d{2})/);
if (!match) {
  console.error("::error::Could not find 'Change Date: YYYY-MM-DD' in LICENSE");
  process.exit(1);
}

const changeDate = new Date(match[1] + "T00:00:00Z");
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

const fourYears = new Date(today);
fourYears.setUTCFullYear(fourYears.getUTCFullYear() + 4);

const fmt = (d) => d.toISOString().slice(0, 10);

if (changeDate <= today) {
  console.error(
    `::error::BUSL Change Date ${fmt(changeDate)} is not in the future (today: ${fmt(today)}).`,
  );
  console.error("Update LICENSE Change Date to a future date (max today + 4 years) before releasing.");
  process.exit(1);
}

if (changeDate > fourYears) {
  console.error(
    `::error::BUSL Change Date ${fmt(changeDate)} is more than 4 years from today (max: ${fmt(fourYears)}).`,
  );
  console.error("BUSL-1.1 covenant caps Change Date at the 4th anniversary of distribution.");
  process.exit(1);
}

const days = Math.round((changeDate - today) / (1000 * 60 * 60 * 24));
console.log(`BUSL Change Date OK: ${fmt(changeDate)} (${days} days from today, max allowed: ${fmt(fourYears)})`);
