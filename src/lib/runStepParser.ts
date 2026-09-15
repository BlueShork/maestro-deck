// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

// Parser for the Maestro CLI's *plain-text* result view — the format the CLI
// uses whenever stdout is not a TTY, which is always the case here since the
// runner pipes it. Verified against maestro 2.5.1 real output and the
// PlainTextResultView source:
//
//   Running on iPhone 16 Pro - iOS 18.2 - <udid>
//    > Flow settings-check                          ← flow header (1 space)
//   Launch app "com.apple.Preferences"... COMPLETED ← leaf: ONE line, at completion
//   Run flow...                                     ← container start (no status)
//     Press back... COMPLETED                       ← children indented 2 sp/level
//   Run flow... COMPLETED                           ← container end
//   Assert that "X" is visible... FAILED            ← no error on the line;
//   Assertion is false: "X" is visible              ← detail follows on its own line
//
// Consequences that shape the whole progress pipeline:
//   - Leaf commands NEVER emit a "started" line through a pipe (the CLI prints
//     `desc...` without a newline and appends the status later — the reader
//     only sees the completed line). Only containers (runFlow/repeat/retry)
//     produce real started events.
//   - Indentation is the ONLY thing distinguishing a subflow's inner step from
//     a top-level step. It must be measured before any trimming.
//   - A YAML `label:` replaces the description entirely, so no pattern table
//     can ever be complete — unrecognized step lines are still emitted with
//     `command: null` and matched positionally by the store.

export type StepEventKind = "started" | "completed" | "failed" | "skipped";

export interface StepEvent {
  kind: StepEventKind;
  /** Nesting depth: 0 = top-level step, 1+ = inside runFlow/repeat/retry. */
  depth: number;
  /** Canonical YAML command name, or null when the description is
   *  unrecognized (custom `label:`, unknown command, future maestro). */
  command: string | null;
  arg: string | null;
  error?: string;
}

export type ParsedRunLine = { type: "flow"; name: string } | { type: "step"; event: StepEvent };

interface Pattern {
  command: string;
  re: RegExp | null;
  bareRe?: RegExp;
}

// Description → command patterns, ordered most-specific-first. Templates come
// from maestro-orchestra-models Commands.kt (v2.5.1) `description()` methods.
// For arg-bearing commands, `re` captures the raw *target* in group 1 — a
// quoted text selector (`"Welcome"`), an unquoted id selector
// (`id: welcomeMessage`), or an unquoted value (`Alice` for inputText).
// `argFromTarget` normalizes it to the bare value so it lines up with the YAML
// AST arg. `bareRe` matches commands with no useful arg.
//
// Matching a pattern is an *optimization*, not a requirement: it enables
// command-aware resync in the store. Lines that look like step lines but match
// no pattern still produce a `command: null` event (see parseRunLine).
const PATTERNS: Pattern[] = [
  { command: "launchApp", re: /^Launch app "(.+?)"/ },
  // "Stop recording" must outrank stopApp's bare `Stop {appId}`.
  { command: "stopRecording", re: null, bareRe: /^Stop recording/ },
  { command: "startRecording", re: /^Start recording (.+?)$/ },
  { command: "stopApp", re: /^Stop (.+?)$/ },
  { command: "killApp", re: /^Kill (.+?)$/ },
  { command: "clearState", re: /^Clear state of (.+?)$/ },
  { command: "clearState", re: null, bareRe: /^Clear state/ },
  { command: "clearKeychain", re: null, bareRe: /^Clear keychain/ },
  { command: "doubleTapOn", re: /^Double tap on (.+?)$/ },
  { command: "longPressOn", re: /^Long press on (.+?)$/ },
  // `tapOn` with repeat > 2 renders as `Tap x3 on ...`.
  { command: "tapOn", re: /^Tap x\d+ on (.+?)$/ },
  { command: "tapOn", re: /^Tap on point \((.+?)\)/ },
  { command: "tapOn", re: /^Tap on (.+?)$/ },
  { command: "assertNotVisible", re: /^Assert that (.+?) is not visible/ },
  { command: "assertVisible", re: /^Assert that (.+?) is visible/ },
  { command: "assertTrue", re: /^Assert that (.+?) is true/ },
  { command: "assertWithAI", re: /^Assert with AI: (.+?)$/ },
  { command: "assertNoDefectsWithAI", re: null, bareRe: /^Assert no defects with AI/ },
  { command: "assertScreenshot", re: /^Assert screenshot matches (.+?) \(threshold/ },
  // Deprecated AssertCommand still prints `Assert visible {sel}`.
  { command: "assertVisible", re: /^Assert visible (.+?)$/ },
  { command: "assertNotVisible", re: /^Assert not visible (.+?)$/ },
  { command: "extractTextWithAI", re: /^Extract text with AI: (.+?)$/ },
  // inputRandom* variants render as `Input text random {TYPE}` — they must
  // outrank the generic inputText pattern.
  { command: "inputRandomEmail", re: null, bareRe: /^Input text random TEXT_EMAIL_ADDRESS/ },
  { command: "inputRandomPersonName", re: null, bareRe: /^Input text random TEXT_PERSON_NAME/ },
  { command: "inputRandomCityName", re: null, bareRe: /^Input text random TEXT_CITY_NAME/ },
  { command: "inputRandomCountryName", re: null, bareRe: /^Input text random TEXT_COUNTRY_NAME/ },
  { command: "inputRandomColorName", re: null, bareRe: /^Input text random TEXT_COLOR/ },
  { command: "inputRandomNumber", re: null, bareRe: /^Input text random NUMBER/ },
  { command: "inputRandomText", re: null, bareRe: /^Input text random TEXT/ },
  { command: "inputText", re: /^Input text (.+?)$/ },
  { command: "eraseText", re: null, bareRe: /^Erase (?:text|\d+ characters)/ },
  { command: "openLink", re: /^Open (.+?)(?: with auto verification)?(?: in browser)?$/ },
  // Maestro 1.x: `Scroll until "X" is visible`. Maestro 2.x: `Scrolling
  // DOWN until "X" is visible with speed 40, ...`. Both must match.
  {
    command: "scrollUntilVisible",
    re: /^Scrolling (?:UP|DOWN|LEFT|RIGHT) until (.+?) is visible/,
  },
  { command: "scrollUntilVisible", re: /^Scroll until (.+?) is visible/ },
  { command: "swipe", re: /^Swiping in (?:UP|DOWN|LEFT|RIGHT) direction on (.+?)$/ },
  { command: "swipe", re: null, bareRe: /^Swiping in (?:UP|DOWN|LEFT|RIGHT) direction/ },
  { command: "swipe", re: null, bareRe: /^Swipe from \(.+?\) to \(.+?\)/ },
  { command: "swipe", re: null, bareRe: /^Invalid input to swipe command/ },
  { command: "scroll", re: null, bareRe: /^Scroll/ },
  // `back` prints `Press back`; pressKey prints `Press {Key} key` — the
  // trailing " key" disambiguates, but keep back first for clarity.
  { command: "back", re: null, bareRe: /^Press back$/ },
  { command: "pressKey", re: /^Press (.+?) key$/ },
  { command: "waitForAnimationToEnd", re: null, bareRe: /^Wait for animation to end/ },
  { command: "hideKeyboard", re: null, bareRe: /^Hide keyboard/i },
  { command: "takeScreenshot", re: /^Take screenshot (.+?)$/ },
  { command: "copyTextFrom", re: /^Copy text from element with (.+?)$/ },
  { command: "setClipboard", re: null, bareRe: /^Set Maestro clipboard to / },
  { command: "pasteText", re: null, bareRe: /^Paste text/ },
  { command: "setLocation", re: null, bareRe: /^Set location \(/ },
  { command: "travel", re: null, bareRe: /^Travel path / },
  { command: "setAirplaneMode", re: null, bareRe: /^(?:Enable|Disable) airplane mode/ },
  { command: "toggleAirplaneMode", re: null, bareRe: /^Toggle airplane mode/ },
  { command: "addMedia", re: null, bareRe: /^Adding media files/ },
  { command: "setOrientation", re: /^Set orientation (.+?)$/ },
  { command: "setPermissions", re: null, bareRe: /^Set permissions/ },
  { command: "repeat", re: null, bareRe: /^Repeat (?:\d+ times|while |indefinitely)/ },
  { command: "retry", re: null, bareRe: /^Retry .*\btimes\b/ },
  // `Run ...` is ambiguous: runFlow inline (`Run flow`), runFlow file
  // (`Run sub.yaml`), runScript (`Run script.js`), evalScript (`Run ${...}`).
  { command: "runFlow", re: null, bareRe: /^Run flow\b/ },
  { command: "runFlow", re: /^Run (\S+\.ya?ml)\b/ },
  { command: "runScript", re: /^Run (\S+\.js)\b/ },
  { command: "evalScript", re: null, bareRe: /^Run \$\{/ },
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

// Terminal statuses (PlainTextResultView): COMPLETED, FAILED, WARNED (an
// `optional: true` step that didn't find its target — treated as completed so
// the gutter stays informative without a false negative), SKIPPED (a `when:`
// condition that wasn't met). FAILED lines carry no message — the detail
// arrives on subsequent plain lines and is attached by the store.
const TERMINAL = /^(.*?)\.\.\.\s+(COMPLETED|FAILED|WARNED|SKIPPED)\s*(.*)$/;
// A line that ends in exactly `...` is a container start (runFlow/repeat/retry
// print their header with a newline; leaf commands don't flush until done).
const STARTED = /^(.*?)\.\.\.$/;
// eslint-disable-next-line no-control-regex -- intentionally strips ESC-prefixed ANSI sequences
const ANSI = /\u001b?\[[0-9;]*[A-Za-z]/g;
const FLOW_HEADER = /^ > Flow (.+)$/;
// Hook headers inside a flow (`  > On Flow Start` / `  > On Flow Complete`).
const HOOK_HEADER = /^\s+> On Flow (?:Start|Complete)$/;
// Maestro injects `(Optional) ` between verb and target when the YAML
// had `optional: true` (tapOn and assert commands only). Strip it so the
// verb regexes still match.
const OPTIONAL_PREFIX =
  /^(Tap on|Long press on|Double tap on|Assert that|Wait until)\s+\(Optional\)\s+/i;

function stripOptionalMarker(line: string): string {
  return line.replace(OPTIONAL_PREFIX, "$1 ");
}

function matchCommand(desc: string): { command: string; arg: string | null } | null {
  for (const p of PATTERNS) {
    if (p.re) {
      const m = p.re.exec(desc);
      if (!m) continue;
      return { command: p.command, arg: argFromTarget(m[1]) };
    }
    if (p.bareRe && p.bareRe.exec(desc)) {
      return { command: p.command, arg: null };
    }
  }
  return null;
}

export function parseRunLine(raw: string): ParsedRunLine | null {
  const noAnsi = raw.replace(ANSI, "").replace(/[\r\n]+$/, "");
  if (!noAnsi.trim()) return null;

  const flow = FLOW_HEADER.exec(noAnsi);
  if (flow) return { type: "flow", name: flow[1].trim() };
  if (HOOK_HEADER.test(noAnsi)) return null;

  // Depth from indentation — PlainTextResultView indents 2 spaces per
  // nesting level. Must be read BEFORE trimming: it is the only signal
  // separating a subflow's inner steps from top-level steps.
  const indent = /^ */.exec(noAnsi)![0].length;
  const depth = Math.floor(indent / 2);
  const line = stripOptionalMarker(noAnsi.trim());

  const tm = TERMINAL.exec(line);
  if (tm) {
    const desc = tm[1].trim();
    const status = tm[2];
    const trailer = tm[3]?.trim() ?? "";
    if (!desc) return null;
    const cmd = matchCommand(desc);
    const kind: StepEventKind =
      status === "FAILED" ? "failed" : status === "SKIPPED" ? "skipped" : "completed";
    const event: StepEvent = {
      kind,
      depth,
      command: cmd?.command ?? null,
      arg: cmd?.arg ?? null,
    };
    if (kind === "failed" && trailer) event.error = trailer;
    return { type: "step", event };
  }

  const sm = STARTED.exec(line);
  if (sm) {
    const desc = sm[1].trim();
    if (!desc) return null;
    const cmd = matchCommand(desc);
    return {
      type: "step",
      event: { kind: "started", depth, command: cmd?.command ?? null, arg: cmd?.arg ?? null },
    };
  }

  return null;
}

/** Legacy single-event helper kept for callers/tests that only care about
 *  top-level step events; prefer `parseRunLine`. */
export function parseLine(raw: string): StepEvent | null {
  const parsed = parseRunLine(raw);
  return parsed?.type === "step" ? parsed.event : null;
}
