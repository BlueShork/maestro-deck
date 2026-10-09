// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

/**
 * Reads Maestro's per-flow result line, printed once per flow when a folder
 * runs (`maestro test <dir>`): `[Passed] login (5s)`, failures add the error
 * in parentheses. Format taken from maestro-cli 2.10.0
 * (TestSuiteStatusView.showFlowCompletion); colours may or may not survive
 * the pipe, so they are stripped first.
 */

export interface SuiteFlowResult {
  name: string;
  status: "passed" | "failed" | "skipped";
  durationMs: number | null;
  error: string | null;
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const TERMINAL: Record<string, SuiteFlowResult["status"]> = {
  Passed: "passed",
  Failed: "failed",
  Stopped: "failed",
  Timeout: "failed",
  "Run expired": "failed",
  Skipped: "skipped",
  "Canceled by user": "skipped",
  "Canceled (unknown reason)": "skipped",
};
const DURATION = "(?:\\d+(?:\\.\\d+)?(?:ms|us|ns|[dhms])\\s*)+";
const LINE = new RegExp(
  `^(?:\\[shard \\d+\\]\\s*)?\\[([^\\]]+)\\]\\s+(.+?)\\s+\\((${DURATION})\\)(?:\\s+\\((.*)\\))?$`,
);
const UNIT_MS: Record<string, number> = {
  d: 86_400_000,
  h: 3_600_000,
  m: 60_000,
  s: 1000,
  ms: 1,
  us: 0.001,
  ns: 0.000001,
};

export function parseDuration(text: string): number | null {
  const flat = text.trim().replace(/\s+/g, " ");
  const parts = [...flat.matchAll(/(\d+(?:\.\d+)?)(ms|us|ns|[dhms])/g)];
  if (!parts.length || parts.map((p) => p[0]).join(" ") !== flat) return null;
  return Math.round(parts.reduce((ms, [, n, unit]) => ms + Number(n) * UNIT_MS[unit], 0));
}

export function parseSuiteLine(raw: string): SuiteFlowResult | null {
  let text = raw.replace(ANSI, "").trim();
  if (text.endsWith(" (Warning)")) text = text.slice(0, -" (Warning)".length).trimEnd();
  const m = LINE.exec(text);
  if (!m) return null;
  const status = TERMINAL[m[1]];
  if (!status) return null;
  return {
    name: m[2],
    status,
    durationMs: parseDuration(m[3]),
    error: status === "failed" && m[4] ? m[4] : null,
  };
}
