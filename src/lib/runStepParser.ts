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
  { command: "scrollUntilVisible", re: /^Scroll until "(.+?)" is visible/ },
  { command: "pressKey", re: /^Press key "(.+?)"/ },
  { command: "waitForAnimationToEnd", re: null, bareRe: /^Wait for animation to end/ },
  { command: "scroll", re: null, bareRe: /^Scroll/ },
  { command: "back", re: null, bareRe: /^Press back/ },
  { command: "hideKeyboard", re: null, bareRe: /^Hide keyboard/ },
  { command: "takeScreenshot", re: null, bareRe: /^Take screenshot/ },
  { command: "clearState", re: null, bareRe: /^Clear state/ },
];

// Single linear regex — bounded by the literal `...` prefix and the trailing
// `$` anchor. Status (COMPLETED/FAILED) is extracted via plain string ops
// below to avoid a regex with optional alternation + `\s*` (ReDoS pattern).
const SUFFIX = /\.\.\.\s*(.*)$/;
const ANSI = /\[[0-9;]*[A-Za-z]/g;

export function parseLine(raw: string): StepEvent | null {
  const line = raw.replace(ANSI, "").trim();
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
    const tail = sm[1];
    if (tail.startsWith("COMPLETED")) {
      return { kind: "completed", command: p.command, arg };
    }
    if (tail.startsWith("FAILED")) {
      const trailer = tail.slice("FAILED".length).trim();
      return { kind: "failed", command: p.command, arg, error: trailer || undefined };
    }
    return { kind: "started", command: p.command, arg };
  }
  return null;
}
