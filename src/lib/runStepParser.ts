// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

export type StepEventKind = "started" | "completed" | "failed";

export interface StepEvent {
  kind: StepEventKind;
  command: string;
  arg: string | null;
  error?: string;
}

interface Pattern {
  command: string;
  re: RegExp | null;
  bareRe?: RegExp;
}

// Patterns are ordered most-specific-first. Each `re` captures the arg
// (typically a quoted text/id); `bareRe` matches commands that have no
// useful arg in the runner output. The Maestro CLI sometimes inserts
// `(Optional)` after the verb when the YAML had `optional: true` —
// we strip it in `stripOptionalMarker` before matching.
const PATTERNS: Pattern[] = [
  { command: "launchApp", re: /^Launch app "(.+?)"/ },
  { command: "stopApp", re: /^Stop app "(.+?)"/ },
  { command: "tapOn", re: /^Tap on "(.+?)"/ },
  { command: "longPressOn", re: /^Long press on "(.+?)"/ },
  { command: "doubleTapOn", re: /^Double tap on "(.+?)"/ },
  { command: "assertVisible", re: /^Assert that "(.+?)" is visible/ },
  { command: "assertNotVisible", re: /^Assert that "(.+?)" is not visible/ },
  { command: "inputText", re: /^Input text "(.+?)"/ },
  { command: "openLink", re: /^Open link "(.+?)"/ },
  // Maestro 1.x: `Scroll until "X" is visible`. Maestro 2.x: `Scrolling
  // DOWN until "X" is visible with speed 40, ...`. Both must match.
  {
    command: "scrollUntilVisible",
    re: /^Scrolling (?:UP|DOWN|LEFT|RIGHT) until "(.+?)" is visible/,
  },
  { command: "scrollUntilVisible", re: /^Scroll until "(.+?)" is visible/ },
  { command: "pressKey", re: /^Press key "(.+?)"/ },
  { command: "waitForAnimationToEnd", re: null, bareRe: /^Wait for animation to end/ },
  { command: "scroll", re: null, bareRe: /^Scroll/ },
  { command: "back", re: null, bareRe: /^Press back/ },
  { command: "hideKeyboard", re: null, bareRe: /^Hide keyboard/ },
  { command: "takeScreenshot", re: null, bareRe: /^Take screenshot/ },
  { command: "clearState", re: null, bareRe: /^Clear state/ },
];

// Maestro reports terminal status as COMPLETED, FAILED, or WARNED (the
// latter for steps marked `optional: true` that didn't find their target
// — they don't fail the run, but we want to mark the line green-ish).
// Treating WARNED as completed keeps the gutter informative without
// surfacing a false negative.
const SUFFIX = /\.\.\.\s*(COMPLETED|FAILED|WARNED)?\s*(.*)$/;
const ANSI = /\[[0-9;]*[A-Za-z]/g;
// Maestro injects `(Optional)` between verb and target when the YAML
// had `optional: true`. Strip it so the verb regexes still match.
const OPTIONAL_PREFIX =
  /^(Tap on|Long press on|Double tap on|Assert that|Wait until)\s+\(Optional\)\s+/i;

function stripOptionalMarker(line: string): string {
  return line.replace(OPTIONAL_PREFIX, "$1 ");
}

export function parseLine(raw: string): StepEvent | null {
  const line = stripOptionalMarker(raw.replace(ANSI, "").trim());
  if (!line) return null;

  for (const p of PATTERNS) {
    let arg: string | null = null;
    let rest: string;

    if (p.re) {
      const m = p.re.exec(line);
      if (!m) continue;
      arg = m[1];
      rest = line.slice(m[0].length);
    } else if (p.bareRe) {
      const m = p.bareRe.exec(line);
      if (!m) continue;
      rest = line.slice(m[0].length);
    } else {
      continue;
    }

    const sm = SUFFIX.exec(rest);
    if (!sm) continue;
    const status = sm[1];
    const trailer = sm[2]?.trim() ?? "";
    if (status === "COMPLETED" || status === "WARNED") {
      return { kind: "completed", command: p.command, arg };
    }
    if (status === "FAILED") {
      return { kind: "failed", command: p.command, arg, error: trailer || undefined };
    }
    return { kind: "started", command: p.command, arg };
  }
  return null;
}
