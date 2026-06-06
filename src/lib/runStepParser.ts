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

// Patterns are ordered most-specific-first. For arg-bearing commands, `re`
// captures the raw *target* in group 1 — which may be a quoted text selector
// (`"Welcome"`), an unquoted id selector (`id: welcomeMessage`), or an unquoted
// value (`Alice` for inputText). `argFromTarget` then normalizes it to the bare
// value so it lines up with the YAML AST arg. `bareRe` matches commands with no
// useful arg. The Maestro CLI sometimes inserts `(Optional)` after the verb when
// the YAML had `optional: true` — we strip it in `stripOptionalMarker` first.
//
// Capture rules:
//   - bare verbs (no trailing keyword): grab the target up to the `...` run
//     indicator via a `(?=\.\.\.)` lookahead, so unquoted ids/values are caught.
//   - assert/scroll verbs: grab the target up to ` is [not] visible`.
//   - app/link/key verbs: the value is always quoted, so capture inside quotes.
const PATTERNS: Pattern[] = [
  { command: "launchApp", re: /^Launch app "(.+?)"/ },
  { command: "stopApp", re: /^Stop app "(.+?)"/ },
  { command: "doubleTapOn", re: /^Double tap on (.+?)(?=\.\.\.)/ },
  { command: "longPressOn", re: /^Long press on (.+?)(?=\.\.\.)/ },
  { command: "tapOn", re: /^Tap on (.+?)(?=\.\.\.)/ },
  { command: "assertNotVisible", re: /^Assert that (.+?) is not visible/ },
  { command: "assertVisible", re: /^Assert that (.+?) is visible/ },
  { command: "inputText", re: /^Input text (.+?)(?=\.\.\.)/ },
  { command: "openLink", re: /^Open link "(.+?)"/ },
  // Maestro 1.x: `Scroll until "X" is visible`. Maestro 2.x: `Scrolling
  // DOWN until "X" is visible with speed 40, ...`. Both must match.
  {
    command: "scrollUntilVisible",
    re: /^Scrolling (?:UP|DOWN|LEFT|RIGHT) until (.+?) is visible/,
  },
  { command: "scrollUntilVisible", re: /^Scroll until (.+?) is visible/ },
  { command: "pressKey", re: /^Press key "(.+?)"/ },
  { command: "waitForAnimationToEnd", re: null, bareRe: /^Wait for animation to end/ },
  { command: "scroll", re: null, bareRe: /^Scroll/ },
  { command: "back", re: null, bareRe: /^Press back/ },
  { command: "hideKeyboard", re: null, bareRe: /^Hide keyboard/ },
  { command: "takeScreenshot", re: null, bareRe: /^Take screenshot/ },
  { command: "clearState", re: null, bareRe: /^Clear state/ },
];

// Normalize a captured selector/target to the bare value that the YAML AST
// stores: a leading quoted segment → its contents (`"Welcome"` → `Welcome`); an
// `id:`-prefixed segment → the id, up to the first comma (`id: foo, disabled` →
// `foo`); otherwise the trimmed target itself (e.g. an unquoted inputText value).
function argFromTarget(target: string): string | null {
  const t = target.trim();
  const quoted = /^"(.*?)"/.exec(t);
  if (quoted) return quoted[1];
  const id = /^id:\s*([^,]+)/.exec(t);
  if (id) return id[1].trim();
  return t.length > 0 ? t : null;
}

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
      arg = argFromTarget(m[1]);
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
