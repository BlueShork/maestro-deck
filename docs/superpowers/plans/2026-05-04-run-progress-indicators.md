# Run Progress Indicators + Simple/Technical Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show live per-step status (pending / running / done / failed) in the YAML editor gutter while a Maestro test runs, and add a Simple/Technical toggle in the run console.

**Architecture:** Pure parsers (`flowAst`, `runStepParser`, `stepRenderer`) feed an extended Zustand `runStore.steps` array. The existing Tauri stdout handler in `App.tsx` is augmented to call the parser and dispatch step events. `FlowEditor` reads steps to render a CodeMirror gutter; `RunConsole` reads steps to render Simple mode. No Rust changes.

**Tech Stack:** TypeScript, React 18, Zustand, CodeMirror 6, Tailwind, Vitest (new), js-yaml (new).

**Spec:** `docs/superpowers/specs/2026-05-04-run-progress-indicators-design.md`

---

## Task 1: Set up Vitest

The repo has no test runner installed. Install Vitest and add a `test` script. We use Vitest because it shares the Vite config and has zero-config TS support.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/__smoke__.test.ts` (deleted at end of task)

- [ ] **Step 1: Install Vitest**

```bash
pnpm add -D vitest @vitest/ui
```

- [ ] **Step 2: Add Vitest config**

Create `vitest.config.ts` at repo root:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3: Add `test` script to `package.json`**

Edit the `"scripts"` block to add (note the trailing comma after `typecheck` line which already exists):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Add a smoke test**

Create `src/lib/__smoke__.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("vitest setup", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run it**

Run: `pnpm test`
Expected: `1 passed`.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm src/lib/__smoke__.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore(test): add vitest"
```

---

## Task 2: `flowAst.ts` — parse YAML to typed steps (TDD)

Parses the user's YAML flow into `Step[]` with line numbers, plus a `byKey` index for fast matching.

**Files:**
- Create: `src/lib/flowAst.ts`
- Test: `src/lib/flowAst.test.ts`

- [ ] **Step 1: Install `js-yaml`**

```bash
pnpm add js-yaml
pnpm add -D @types/js-yaml
```

- [ ] **Step 2: Write the failing tests**

Create `src/lib/flowAst.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFlow } from "./flowAst";

describe("parseFlow", () => {
  it("parses a simple flow with command + arg + line", () => {
    const yaml = `appId: com.example.app
---
- launchApp
- tapOn: "Login"
- assertVisible: "Welcome"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps).toEqual([
      { index: 0, line: 3, command: "launchApp", arg: null },
      { index: 1, line: 4, command: "tapOn", arg: "Login" },
      { index: 2, line: 5, command: "assertVisible", arg: "Welcome" },
    ]);
  });

  it("indexes by command|arg in byKey", () => {
    const yaml = `appId: x
---
- tapOn: "Login"
- tapOn: "Login"
- tapOn: "Submit"
`;
    const ast = parseFlow(yaml);
    expect(ast.byKey.get("tapOn|Login")).toEqual([0, 1]);
    expect(ast.byKey.get("tapOn|Submit")).toEqual([2]);
  });

  it("returns empty AST on invalid YAML without throwing", () => {
    const ast = parseFlow("appId: x\n---\n- tapOn: [unclosed");
    expect(ast.steps).toEqual([]);
    expect(ast.byKey.size).toBe(0);
  });

  it("handles a flow with no header (single doc)", () => {
    const yaml = `- launchApp\n- tapOn: "X"\n`;
    const ast = parseFlow(yaml);
    expect(ast.steps).toEqual([
      { index: 0, line: 1, command: "launchApp", arg: null },
      { index: 1, line: 2, command: "tapOn", arg: "X" },
    ]);
  });

  it("extracts the .id field as the arg for object-form commands when no primary string arg exists", () => {
    const yaml = `appId: x
---
- tapOn:
    id: "login_btn"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps[0]).toMatchObject({ command: "tapOn", arg: "login_btn" });
  });

  it("uses the package name as arg for launchApp object form", () => {
    const yaml = `appId: x
---
- launchApp:
    appId: "com.example.foo"
`;
    const ast = parseFlow(yaml);
    expect(ast.steps[0]).toMatchObject({ command: "launchApp", arg: "com.example.foo" });
  });
});
```

- [ ] **Step 3: Run tests to confirm they fail**

Run: `pnpm test src/lib/flowAst.test.ts`
Expected: all FAIL (`Cannot find module './flowAst'`).

- [ ] **Step 4: Implement `flowAst.ts`**

Create `src/lib/flowAst.ts`:

```ts
import yaml from "js-yaml";

export interface Step {
  index: number;
  line: number;
  command: string;
  arg: string | null;
}

export interface FlowAst {
  steps: Step[];
  byKey: Map<string, number[]>;
}

const EMPTY: FlowAst = { steps: [], byKey: new Map() };

export function parseFlow(source: string): FlowAst {
  const docs = splitDocs(source);
  const flowDoc = docs[docs.length - 1];
  if (!flowDoc) return EMPTY;

  let parsed: unknown;
  try {
    parsed = yaml.load(flowDoc.body);
  } catch {
    return EMPTY;
  }
  if (!Array.isArray(parsed)) return EMPTY;

  const steps: Step[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i];
    const step = normalize(raw);
    if (!step) continue;
    const lineInDoc = findItemLine(flowDoc.body, i);
    steps.push({
      index: steps.length,
      line: flowDoc.startLine + lineInDoc,
      command: step.command,
      arg: step.arg,
    });
  }

  const byKey = new Map<string, number[]>();
  for (const s of steps) {
    const k = `${s.command}|${s.arg ?? ""}`;
    const arr = byKey.get(k);
    if (arr) arr.push(s.index);
    else byKey.set(k, [s.index]);
  }
  return { steps, byKey };
}

interface DocSlice {
  body: string;
  startLine: number; // 1-based line of the doc's first body line in the original source
}

function splitDocs(source: string): DocSlice[] {
  const lines = source.split("\n");
  const slices: DocSlice[] = [];
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      if (i > bodyStart) {
        slices.push({
          body: lines.slice(bodyStart, i).join("\n"),
          startLine: bodyStart + 1,
        });
      }
      bodyStart = i + 1;
    }
  }
  if (bodyStart < lines.length) {
    slices.push({
      body: lines.slice(bodyStart).join("\n"),
      startLine: bodyStart + 1,
    });
  }
  return slices;
}

/**
 * Find the 0-based line offset (within the given body) of the n-th top-level
 * sequence item. Top-level items are lines starting with "- " at column 0.
 */
function findItemLine(body: string, itemIndex: number): number {
  const lines = body.split("\n");
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^- /.test(lines[i]) || /^-$/.test(lines[i].trimEnd())) {
      if (count === itemIndex) return i;
      count++;
    }
  }
  return 0;
}

function normalize(raw: unknown): { command: string; arg: string | null } | null {
  if (typeof raw === "string") {
    return { command: raw, arg: null };
  }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const entries = Object.entries(raw as Record<string, unknown>);
    if (entries.length === 0) return null;
    const [command, value] = entries[0];
    return { command, arg: extractArg(command, value) };
  }
  return null;
}

function extractArg(command: string, value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (command === "launchApp" && typeof obj.appId === "string") return obj.appId;
    if (typeof obj.id === "string") return obj.id;
    if (typeof obj.text === "string") return obj.text;
  }
  return null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/lib/flowAst.test.ts`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/flowAst.ts src/lib/flowAst.test.ts
git commit -m "feat(lib): add flowAst parser for YAML steps"
```

---

## Task 3: `runStepParser.ts` — parse Maestro stdout lines (TDD)

Pure function from a stdout line to a `StepEvent` (or `null` for noise).

**Files:**
- Create: `src/lib/runStepParser.ts`
- Test: `src/lib/runStepParser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/runStepParser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseLine } from "./runStepParser";

describe("parseLine", () => {
  it("parses launchApp completed", () => {
    expect(parseLine(`Launch app "com.example"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "launchApp",
      arg: "com.example",
    });
  });

  it("parses launchApp started (no suffix)", () => {
    expect(parseLine(`Launch app "com.example"...`)).toEqual({
      kind: "started",
      command: "launchApp",
      arg: "com.example",
    });
  });

  it("parses tapOn", () => {
    expect(parseLine(`Tap on "Login"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "tapOn",
      arg: "Login",
    });
  });

  it("parses assertVisible failed", () => {
    expect(parseLine(`Assert that "Welcome" is visible... FAILED`)).toMatchObject({
      kind: "failed",
      command: "assertVisible",
      arg: "Welcome",
    });
  });

  it("parses inputText", () => {
    expect(parseLine(`Input text "user@example.com"... COMPLETED`)).toEqual({
      kind: "completed",
      command: "inputText",
      arg: "user@example.com",
    });
  });

  it("returns null for system lines", () => {
    expect(parseLine(`[runner started pid 21975 · /tmp/foo.yaml]`)).toBeNull();
    expect(parseLine(`Running on R3CX30GR07Y`)).toBeNull();
    expect(parseLine(` > Flow Untitled`)).toBeNull();
    expect(parseLine(``)).toBeNull();
  });

  it("returns null for unknown commands", () => {
    expect(parseLine(`Doing something weird "X"... COMPLETED`)).toBeNull();
  });

  it("trims ANSI escape codes before matching", () => {
    expect(parseLine(`[32mLaunch app "x"... COMPLETED[0m`)).toEqual({
      kind: "completed",
      command: "launchApp",
      arg: "x",
    });
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/lib/runStepParser.test.ts`
Expected: all FAIL.

- [ ] **Step 3: Implement `runStepParser.ts`**

Create `src/lib/runStepParser.ts`:

```ts
export type StepEventKind = "started" | "completed" | "failed";

export interface StepEvent {
  kind: StepEventKind;
  command: string;
  arg: string | null;
  error?: string;
}

interface Pattern {
  command: string;
  // The capture group is the arg. `null` means the command takes no arg.
  re: RegExp | null;
  // Some commands have no quoted arg (e.g. "Hide keyboard..."). We still match
  // their leading sentence.
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

const SUFFIX = /\.\.\.\s*(COMPLETED|FAILED)?\s*(.*)$/;
// strip ANSI CSI sequences
const ANSI = /\[[0-9;]*[A-Za-z]/g;

export function parseLine(raw: string): StepEvent | null {
  const line = raw.replace(ANSI, "").trim();
  if (!line) return null;

  for (const p of PATTERNS) {
    let arg: string | null = null;
    let rest: string | null = null;

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
    if (status === "COMPLETED") {
      return { kind: "completed", command: p.command, arg };
    }
    if (status === "FAILED") {
      return { kind: "failed", command: p.command, arg, error: trailer || undefined };
    }
    return { kind: "started", command: p.command, arg };
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/runStepParser.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/runStepParser.ts src/lib/runStepParser.test.ts
git commit -m "feat(lib): add runStepParser for Maestro stdout lines"
```

---

## Task 4: `stepRenderer.ts` — human labels and duration formatting (TDD)

**Files:**
- Create: `src/lib/stepRenderer.ts`
- Test: `src/lib/stepRenderer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/stepRenderer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { humanLabel, formatDuration } from "./stepRenderer";

describe("humanLabel", () => {
  it("formats launchApp", () => {
    expect(humanLabel({ command: "launchApp", arg: "com.example" })).toBe("Open com.example app");
  });

  it("formats tapOn", () => {
    expect(humanLabel({ command: "tapOn", arg: "Login" })).toBe(`Tap "Login"`);
  });

  it("formats assertVisible", () => {
    expect(humanLabel({ command: "assertVisible", arg: "Welcome" })).toBe(
      `Check that "Welcome" is visible`,
    );
  });

  it("formats inputText", () => {
    expect(humanLabel({ command: "inputText", arg: "hello" })).toBe(`Type "hello"`);
  });

  it("formats arg-less commands", () => {
    expect(humanLabel({ command: "back", arg: null })).toBe("Press back");
    expect(humanLabel({ command: "hideKeyboard", arg: null })).toBe("Hide keyboard");
  });

  it("falls back to raw command for unknown command + arg", () => {
    expect(humanLabel({ command: "weirdThing", arg: "x" })).toBe(`weirdThing "x"`);
    expect(humanLabel({ command: "weirdThing", arg: null })).toBe("weirdThing");
  });
});

describe("formatDuration", () => {
  it("under 100ms shows <0.1s", () => {
    expect(formatDuration(50)).toBe("<0.1s");
  });

  it("formats sub-second", () => {
    expect(formatDuration(345)).toBe("0.3s");
  });

  it("formats seconds with one decimal", () => {
    expect(formatDuration(1234)).toBe("1.2s");
    expect(formatDuration(12_400)).toBe("12.4s");
  });

  it("returns empty string for null", () => {
    expect(formatDuration(null)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/lib/stepRenderer.test.ts`
Expected: all FAIL.

- [ ] **Step 3: Implement `stepRenderer.ts`**

Create `src/lib/stepRenderer.ts`:

```ts
export interface LabelInput {
  command: string;
  arg: string | null;
}

const TEMPLATES: Record<string, (arg: string | null) => string> = {
  launchApp: (a) => `Open ${a ?? "app"} app`,
  stopApp: (a) => `Stop ${a ?? "app"}`,
  tapOn: (a) => (a ? `Tap "${a}"` : "Tap"),
  longPressOn: (a) => (a ? `Long press "${a}"` : "Long press"),
  doubleTapOn: (a) => (a ? `Double tap "${a}"` : "Double tap"),
  assertVisible: (a) => (a ? `Check that "${a}" is visible` : "Check visibility"),
  assertNotVisible: (a) => (a ? `Check that "${a}" is NOT visible` : "Check absence"),
  inputText: (a) => (a ? `Type "${a}"` : "Type text"),
  openLink: (a) => (a ? `Open link ${a}` : "Open link"),
  scrollUntilVisible: (a) => (a ? `Scroll until "${a}" is visible` : "Scroll"),
  pressKey: (a) => (a ? `Press ${a} key` : "Press key"),
  scroll: () => "Scroll",
  back: () => "Press back",
  hideKeyboard: () => "Hide keyboard",
  takeScreenshot: () => "Take screenshot",
  clearState: () => "Clear app state",
  waitForAnimationToEnd: () => "Wait for animations",
};

export function humanLabel({ command, arg }: LabelInput): string {
  const t = TEMPLATES[command];
  if (t) return t(arg);
  return arg ? `${command} "${arg}"` : command;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return "";
  if (ms < 100) return "<0.1s";
  return `${(ms / 1000).toFixed(1)}s`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/stepRenderer.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stepRenderer.ts src/lib/stepRenderer.test.ts
git commit -m "feat(lib): add stepRenderer for human-readable step labels"
```

---

## Task 5: Extend `runStore` with steps + applyEvent (TDD)

**Files:**
- Modify: `src/stores/runStore.ts`
- Test: `src/stores/runStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/stores/runStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useRunStore } from "./runStore";
import type { Step } from "@/lib/flowAst";

const mkSteps = (): Step[] => [
  { index: 0, line: 3, command: "launchApp", arg: "com.example" },
  { index: 1, line: 4, command: "tapOn", arg: "Login" },
  { index: 2, line: 5, command: "tapOn", arg: "Login" }, // duplicate
];

describe("runStore.steps", () => {
  beforeEach(() => {
    useRunStore.getState().resetSteps();
    useRunStore.setState({ logs: [], running: false, pid: null, exitCode: null });
  });

  it("initSteps populates with pending status", () => {
    useRunStore.getState().initSteps(mkSteps());
    const steps = useRunStore.getState().steps;
    expect(steps).toHaveLength(3);
    expect(steps.every((s) => s.status === "pending")).toBe(true);
    expect(steps[0]).toMatchObject({ index: 0, line: 3, command: "launchApp", status: "pending" });
  });

  it("applyEvent transitions started → running", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "started", command: "launchApp", arg: "com.example" });
    expect(useRunStore.getState().steps[0].status).toBe("running");
    expect(useRunStore.getState().steps[0].startedAt).not.toBeNull();
  });

  it("applyEvent transitions completed → done with duration", async () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "started", command: "launchApp", arg: "com.example" });
    await new Promise((r) => setTimeout(r, 5));
    useRunStore
      .getState()
      .applyEvent({ kind: "completed", command: "launchApp", arg: "com.example" });
    const s = useRunStore.getState().steps[0];
    expect(s.status).toBe("done");
    expect(s.durationMs).not.toBeNull();
    expect(s.durationMs!).toBeGreaterThanOrEqual(0);
  });

  it("applyEvent failed sets error", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore
      .getState()
      .applyEvent({ kind: "started", command: "tapOn", arg: "Login" });
    useRunStore
      .getState()
      .applyEvent({ kind: "failed", command: "tapOn", arg: "Login", error: "Element not found" });
    const s = useRunStore.getState().steps[1];
    expect(s.status).toBe("failed");
    expect(s.error).toBe("Element not found");
  });

  it("with duplicate steps, falls back to first pending match", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "completed", command: "tapOn", arg: "Login" });
    useRunStore.getState().applyEvent({ kind: "completed", command: "tapOn", arg: "Login" });
    const steps = useRunStore.getState().steps;
    expect(steps[1].status).toBe("done");
    expect(steps[2].status).toBe("done");
  });

  it("applyEvent with unknown command is a no-op", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().applyEvent({ kind: "completed", command: "weirdThing", arg: "x" });
    const steps = useRunStore.getState().steps;
    expect(steps.every((s) => s.status === "pending")).toBe(true);
  });

  it("resetSteps empties the array", () => {
    useRunStore.getState().initSteps(mkSteps());
    useRunStore.getState().resetSteps();
    expect(useRunStore.getState().steps).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm test src/stores/runStore.test.ts`
Expected: all FAIL (`initSteps is not a function`).

- [ ] **Step 3: Modify `src/stores/runStore.ts`**

Replace the entire file content with:

```ts
import { create } from "zustand";

import type { Step } from "@/lib/flowAst";
import type { StepEvent } from "@/lib/runStepParser";

export type LogStream = "stdout" | "stderr" | "system";

export interface LogLine {
  id: number;
  stream: LogStream;
  text: string;
  timestamp: number;
}

export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepRunState {
  index: number;
  line: number;
  command: string;
  arg: string | null;
  status: StepStatus;
  startedAt: number | null;
  durationMs: number | null;
  error: string | null;
}

interface RunState {
  running: boolean;
  pid: number | null;
  exitCode: number | null;
  stopRequested: boolean;
  logs: LogLine[];
  steps: StepRunState[];
  setRunning: (pid: number) => void;
  requestStop: () => void;
  setStopped: (exitCode: number | null) => void;
  appendLog: (stream: LogStream, text: string) => void;
  clearLogs: () => void;
  initSteps: (steps: Step[]) => void;
  applyEvent: (e: StepEvent) => void;
  resetSteps: () => void;
}

let nextId = 1;

function pickIndex(steps: StepRunState[], command: string, arg: string | null): number | null {
  // Prefer the first pending match, falling back to the first match overall.
  let firstAny: number | null = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.command !== command) continue;
    if ((s.arg ?? "") !== (arg ?? "")) continue;
    if (firstAny === null) firstAny = i;
    if (s.status === "pending" || s.status === "running") return i;
  }
  return firstAny;
}

export const useRunStore = create<RunState>((set) => ({
  running: false,
  pid: null,
  exitCode: null,
  stopRequested: false,
  logs: [],
  steps: [],
  setRunning: (pid) =>
    set({ running: true, pid, exitCode: null, stopRequested: false, logs: [] }),
  requestStop: () => set({ stopRequested: true }),
  setStopped: (exitCode) => set({ running: false, pid: null, exitCode }),
  appendLog: (stream, text) =>
    set((s) => {
      const entry = { id: nextId++, stream, text, timestamp: Date.now() };
      const MAX = 2000;
      if (s.logs.length < MAX) return { logs: [...s.logs, entry] };
      return { logs: [...s.logs.slice(s.logs.length - MAX + 1), entry] };
    }),
  clearLogs: () => set({ logs: [] }),
  initSteps: (steps) =>
    set({
      steps: steps.map((s) => ({
        index: s.index,
        line: s.line,
        command: s.command,
        arg: s.arg,
        status: "pending" as StepStatus,
        startedAt: null,
        durationMs: null,
        error: null,
      })),
    }),
  applyEvent: (e) =>
    set((state) => {
      const idx = pickIndex(state.steps, e.command, e.arg);
      if (idx === null) return {};
      const next = state.steps.slice();
      const s = { ...next[idx] };
      const now = performance.now();
      if (e.kind === "started") {
        s.status = "running";
        s.startedAt = now;
      } else if (e.kind === "completed") {
        s.status = "done";
        s.durationMs = s.startedAt !== null ? now - s.startedAt : 0;
      } else if (e.kind === "failed") {
        s.status = "failed";
        s.durationMs = s.startedAt !== null ? now - s.startedAt : 0;
        s.error = e.error ?? null;
      }
      next[idx] = s;
      return { steps: next };
    }),
  resetSteps: () => set({ steps: [] }),
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/stores/runStore.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Run typecheck and full test suite**

Run: `pnpm typecheck && pnpm test`
Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/stores/runStore.ts src/stores/runStore.test.ts
git commit -m "feat(store): add steps tracking and applyEvent to runStore"
```

---

## Task 6: Wire stdout parser + run-start AST snapshot in `App.tsx`

The existing handler `events.onRunnerStdout((line) => appendLog("stdout", line))` is augmented to also call `parseLine` and dispatch via `applyEvent`. The `onRun` and `onRunAll` callbacks parse the current YAML and call `initSteps` before spawning.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

In `src/App.tsx`, after the existing `import { useShortcuts } from "@/lib/keyboard";` line, add:

```ts
import { parseFlow } from "@/lib/flowAst";
import { parseLine as parseRunLine } from "@/lib/runStepParser";
```

- [ ] **Step 2: Pull additional run-store actions**

Around the existing `const appendLog = useRunStore((s) => s.appendLog);` line, add:

```ts
const initSteps = useRunStore((s) => s.initSteps);
const applyStepEvent = useRunStore((s) => s.applyEvent);
const resetSteps = useRunStore((s) => s.resetSteps);
```

- [ ] **Step 3: Augment the stdout handler**

Find the existing `events.onRunnerStdout((line) => appendLog("stdout", line)),` and replace with:

```ts
events.onRunnerStdout((line) => {
  appendLog("stdout", line);
  const ev = parseRunLine(line);
  if (ev) applyStepEvent(ev);
}),
```

Also extend the deps array of that `useEffect` to include `applyStepEvent`. Find:

```ts
}, [appendLog, setStopped, markDisconnected, appendSample, onTargetChanged, setStoppedReason]);
```

Replace with:

```ts
}, [
  appendLog,
  applyStepEvent,
  setStopped,
  markDisconnected,
  appendSample,
  onTargetChanged,
  setStoppedReason,
]);
```

- [ ] **Step 4: Snapshot AST at run start**

In the `onRun` callback, immediately after `await writeTextFile(path, content);` (the second occurrence — inside the `else` branch — keep both occurrences and place the snapshot AFTER the if/else block, before the `runFlow` call). The simplest patch is to add the call right before `const pid = await ipc.runFlow(path);`. Replace:

```ts
const pid = await ipc.runFlow(path);
setRunning(pid);
appendLog("system", `[runner started pid ${pid} · ${path}]`);
```

With:

```ts
initSteps(parseFlow(content).steps);
const pid = await ipc.runFlow(path);
setRunning(pid);
appendLog("system", `[runner started pid ${pid} · ${path}]`);
```

Update the `onRun` deps to include `initSteps`:

```ts
}, [setRunning, appendLog, initSteps]);
```

- [ ] **Step 5: Snapshot AST at runAll start too**

In `onRunAll`, right before `const pid = await ipc.runFlow(folder);`, insert:

```ts
const { content: c2 } = useFlowStore.getState();
initSteps(parseFlow(c2).steps);
```

Update the `onRunAll` deps to include `initSteps`:

```ts
}, [setRunning, appendLog, initSteps]);
```

- [ ] **Step 6: Reset steps on the next run via `setRunning`**

This is already handled because `initSteps` is called BEFORE `setRunning`, and `setRunning` does not touch `steps`. But to clear stale markers when the user clicks Run on a flow with no recognizable steps, also add a `resetSteps()` call before `initSteps`. In both `onRun` and `onRunAll`, change:

```ts
initSteps(parseFlow(content).steps);
```

to:

```ts
resetSteps();
initSteps(parseFlow(content).steps);
```

(In `onRunAll`, use `c2` instead of `content`.)

Add `resetSteps` to both callback deps lists.

- [ ] **Step 7: Run typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 8: Manual smoke test**

Run: `pnpm tauri:dev` — start the app, connect a device, open a flow with at least 2 instructions, click Run.

Expected: the run still completes normally, console behavior unchanged. (The gutter dots aren't visible yet — that's Task 7.) Open the React DevTools or use a console log to verify `useRunStore.getState().steps` populates and transitions during the run.

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): wire stdout parser to runStore step events"
```

---

## Task 7: CodeMirror gutter in `FlowEditor.tsx`

Adds a 14 px gutter to the left of line numbers showing the per-step status marker.

**Files:**
- Modify: `src/components/FlowEditor.tsx`
- Modify: `src/styles/index.css` (or wherever CodeMirror styles live — see Step 1)

- [ ] **Step 1: Locate the CodeMirror style file**

Run: `grep -rn "cm-active-run-line" /Users/ethanmorisset/maestro-deck/src` to find which CSS file styles the existing run-line decoration. Add new styles to that same file. (Likely `src/styles/index.css` or `src/lib/editor-theme.ts` — confirm before writing.)

- [ ] **Step 2: Add CSS for gutter markers**

Append to the located file:

```css
.cm-step-status {
  width: 14px;
  padding: 0;
}
.cm-step-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 100%;
  font-size: 9px;
  line-height: 1;
}
.cm-step-marker.done {
  color: rgb(16 185 129);
}
.cm-step-marker.failed {
  color: rgb(239 68 68);
}
.cm-step-marker.running {
  color: rgb(59 130 246);
  animation: cm-step-spin 0.9s linear infinite;
}
@keyframes cm-step-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
```

- [ ] **Step 3: Add the gutter extension to `FlowEditor.tsx`**

In `src/components/FlowEditor.tsx`:

a) After the existing CodeMirror imports, add:

```ts
import { gutter, GutterMarker } from "@codemirror/view";
```

b) After `const setActiveLine = StateEffect.define<number | null>();`, add:

```ts
type StepStatusMap = Map<number, "running" | "done" | "failed">;

const setStepStatuses = StateEffect.define<StepStatusMap>();

const stepStatusField = StateField.define<StepStatusMap>({
  create: () => new Map(),
  update(map, tr) {
    for (const e of tr.effects) {
      if (e.is(setStepStatuses)) return e.value;
    }
    return map;
  },
});

class StepMarker extends GutterMarker {
  constructor(readonly status: "running" | "done" | "failed") {
    super();
  }
  override eq(other: GutterMarker): boolean {
    return other instanceof StepMarker && other.status === this.status;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement("span");
    el.className = `cm-step-marker ${this.status}`;
    if (this.status === "done") el.textContent = "●";
    else if (this.status === "failed") el.textContent = "✕";
    else el.textContent = "◐";
    return el;
  }
}

const stepGutter = gutter({
  class: "cm-step-status",
  lineMarker(view, line) {
    const map = view.state.field(stepStatusField, false);
    if (!map) return null;
    const lineNo = view.state.doc.lineAt(line.from).number;
    const status = map.get(lineNo);
    return status ? new StepMarker(status) : null;
  },
  lineMarkerChange(update) {
    return update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(setStepStatuses)),
    );
  },
});
```

c) In the `EditorState.create` extensions array, insert `stepGutter` and `stepStatusField` BEFORE `lineNumbers()` so the new gutter sits to the LEFT of line numbers:

```ts
extensions: [
  stepStatusField,
  stepGutter,
  lineNumbers(),
  // ...rest unchanged
],
```

d) Read `runStore.steps` and dispatch the effect when it changes. Near the existing `const activeLine = useFlowStore((s) => s.activeLine);` line, add:

```ts
const steps = useRunStore((s) => s.steps);
```

(Add the import: `import { useRunStore } from "@/stores/runStore";` near the other store imports.)

e) Add an effect that pushes the map to the editor:

```ts
useEffect(() => {
  const view = viewRef.current;
  if (!view) return;
  const map: StepStatusMap = new Map();
  for (const s of steps) {
    if (s.status === "running" || s.status === "done" || s.status === "failed") {
      map.set(s.line, s.status);
    }
  }
  view.dispatch({ effects: setStepStatuses.of(map) });
}, [steps]);
```

Place this useEffect right after the existing `useEffect(() => { viewRef.current?.dispatch(...setActiveLine...) }, [activeLine]);`.

- [ ] **Step 4: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 5: Manual test**

Run: `pnpm tauri:dev`. Open a flow with `launchApp`, `tapOn: "X"`, `assertVisible: "Y"`. Run it.

Expected during run: the running line shows a spinning ◐ in blue, completed lines show a green ●, failures (if any) show a red ✕. Lines without a step (e.g. `appId:`, `---`) show nothing.

- [ ] **Step 6: Commit**

```bash
git add src/components/FlowEditor.tsx src/styles/index.css   # adjust path to actual file
git commit -m "feat(editor): add per-step status gutter showing live run progress"
```

---

## Task 8: Add `consoleMode` to `settingsStore`

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add the field, action, and partialize entry**

In `src/stores/settingsStore.ts`:

a) Add to the type union and interface:

```ts
export type ConsoleMode = "simple" | "technical";
```

Add inside `SettingsState`:

```ts
consoleMode: ConsoleMode;
setConsoleMode: (m: ConsoleMode) => void;
```

b) Add to the initial state object inside the `create` callback:

```ts
consoleMode: "simple",
setConsoleMode: (consoleMode) => set({ consoleMode }),
```

c) Add to the `partialize` projection:

```ts
partialize: (s) => ({
  inspectKey: s.inspectKey,
  theme: s.theme,
  streamEnabled: s.streamEnabled,
  perfMonitoringEnabled: s.perfMonitoringEnabled,
  fastHierarchyEnabled: s.fastHierarchyEnabled,
  consoleMode: s.consoleMode,
}),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add consoleMode (simple|technical), default simple"
```

---

## Task 9: Console toggle + Simple mode rendering

**Files:**
- Modify: `src/components/RunConsole.tsx`

- [ ] **Step 1: Add imports and selectors**

At the top of `src/components/RunConsole.tsx`, add to the existing imports:

```ts
import { humanLabel, formatDuration } from "@/lib/stepRenderer";
```

(`useSettingsStore` is already imported.) Inside the component, near the existing setting selectors, add:

```ts
const consoleMode = useSettingsStore((s) => s.consoleMode);
const setConsoleMode = useSettingsStore((s) => s.setConsoleMode);
const steps = useRunStore((s) => s.steps);
```

(Add `import { useRunStore } from "@/stores/runStore";` if not already present — yes it already imports it. Add only the new selector lines.)

- [ ] **Step 2: Add the segmented toggle in the header**

Find the existing header `div className="flex items-center gap-1"` block and prepend (BEFORE the `{perfEnabled && ...}` Perf button) the toggle:

```tsx
<div className="mr-1 flex overflow-hidden rounded border border-border">
  <button
    type="button"
    onClick={() => setConsoleMode("simple")}
    className={cn(
      "px-2 py-0.5 text-[10px]",
      consoleMode === "simple"
        ? "bg-primary text-primary-foreground"
        : "bg-transparent text-muted-foreground hover:bg-muted",
    )}
  >
    Simple
  </button>
  <button
    type="button"
    onClick={() => setConsoleMode("technical")}
    className={cn(
      "px-2 py-0.5 text-[10px]",
      consoleMode === "technical"
        ? "bg-primary text-primary-foreground"
        : "bg-transparent text-muted-foreground hover:bg-muted",
    )}
  >
    Technical
  </button>
</div>
```

- [ ] **Step 3: Branch the body rendering**

Replace the existing scroll-area body — the block that starts with `{logs.length === 0 ? (...)}` and ends with `</div>` for that scroll area — with a branched rendering. Find this block:

```tsx
{logs.length === 0 ? (
  <div className="text-muted-foreground">
    No output yet. Press Run to execute the current flow.
  </div>
) : (
  logs.map((l) => (
    <div
      key={l.id}
      className={cn(
        "whitespace-pre-wrap",
        l.stream === "stderr" && "text-red-700 dark:text-red-300",
        l.stream === "system" && "text-muted-foreground italic",
      )}
    >
      {renderAnsi(l.text)}
    </div>
  ))
)}
```

Replace it with:

```tsx
{consoleMode === "technical"
  ? logs.length === 0
    ? (
        <div className="text-muted-foreground">
          No output yet. Press Run to execute the current flow.
        </div>
      )
    : logs.map((l) => (
        <div
          key={l.id}
          className={cn(
            "whitespace-pre-wrap",
            l.stream === "stderr" && "text-red-700 dark:text-red-300",
            l.stream === "system" && "text-muted-foreground italic",
          )}
        >
          {renderAnsi(l.text)}
        </div>
      ))
  : <SimpleConsoleBody
      steps={steps}
      running={running}
      exitCode={exitCode}
      stopRequested={useRunStore.getState().stopRequested}
    />}
```

- [ ] **Step 4: Add the `SimpleConsoleBody` component**

At the bottom of `src/components/RunConsole.tsx`, after the `RunConsole` function, add:

```tsx
import type { StepRunState } from "@/stores/runStore";

function SimpleConsoleBody({
  steps,
  running,
  exitCode,
  stopRequested,
}: {
  steps: StepRunState[];
  running: boolean;
  exitCode: number | null;
  stopRequested: boolean;
}) {
  if (steps.length === 0) {
    return (
      <div className="text-muted-foreground">
        No output yet. Press Run to execute the current flow.
      </div>
    );
  }
  const failedAt = steps.findIndex((s) => s.status === "failed");
  const totalMs = steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  return (
    <div className="space-y-0.5">
      {steps.map((s) => (
        <SimpleStepLine key={s.index} step={s} />
      ))}
      {!running && exitCode !== null && (
        <SimpleSummary
          exitCode={exitCode}
          stopRequested={stopRequested}
          totalSteps={steps.length}
          totalMs={totalMs}
          failedAt={failedAt}
        />
      )}
    </div>
  );
}

function SimpleStepLine({ step }: { step: StepRunState }) {
  const icon =
    step.status === "running"
      ? "▶"
      : step.status === "done"
        ? "✓"
        : step.status === "failed"
          ? "✗"
          : " ";
  const colorClass =
    step.status === "done"
      ? "text-emerald-600 dark:text-emerald-400"
      : step.status === "failed"
        ? "text-red-600 dark:text-red-400"
        : step.status === "running"
          ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground";
  const label = humanLabel(step);
  const duration = step.status === "running" ? "…" : formatDuration(step.durationMs);
  return (
    <div className={cn("flex items-baseline gap-2 whitespace-pre", colorClass)}>
      <span className="w-3 text-center">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      <span className="tabular-nums text-muted-foreground">{duration}</span>
      {step.status === "failed" && step.error ? (
        <span className="ml-2 truncate text-red-500/80" title={step.error}>
          — {step.error}
        </span>
      ) : null}
    </div>
  );
}

function SimpleSummary({
  exitCode,
  stopRequested,
  totalSteps,
  totalMs,
  failedAt,
}: {
  exitCode: number;
  stopRequested: boolean;
  totalSteps: number;
  totalMs: number;
  failedAt: number;
}) {
  if (stopRequested) {
    return <div className="mt-2 text-muted-foreground">⏹  Test stopped</div>;
  }
  if (exitCode === 0 && failedAt === -1) {
    return (
      <div className="mt-2 text-emerald-600 dark:text-emerald-400">
        ✅  Test passed — {totalSteps} step{totalSteps === 1 ? "" : "s"} in{" "}
        {formatDuration(totalMs) || "<0.1s"}
      </div>
    );
  }
  return (
    <div className="mt-2 text-red-600 dark:text-red-400">
      ❌  Test failed{failedAt >= 0 ? ` at step ${failedAt + 1}` : ""}
    </div>
  );
}
```

Note: `useRunStore.getState().stopRequested` in Step 3 is read once per render via `getState` to avoid an extra subscription. If you prefer the reactive form, replace with `const stopRequested = useRunStore((s) => s.stopRequested);` near the other selectors and pass that. Either works; the reactive form is cleaner — use it.

Apply the cleanup: add `const stopRequested = useRunStore((s) => s.stopRequested);` and replace `useRunStore.getState().stopRequested` in the JSX with `stopRequested`.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Manual test**

Run: `pnpm tauri:dev`. Open a flow with 3+ steps. Run it.

Expected:
- Default view is Simple mode.
- During the run, the running step shows ▶ in blue with `…`, finished steps show ✓ in green with their duration.
- After exit 0: green `✅  Test passed — N steps in T.Ts` summary.
- Toggle to Technical: the original raw stdout view appears, including `[runner started ...]` and `[runner exited ...]` lines.
- Toggle back to Simple: the formatted view re-appears with no data loss.
- Force a failure (e.g., `assertVisible: "DoesNotExist"`): failed step shows ✗ red, summary shows red `❌  Test failed at step K`.
- Click Stop mid-run: summary shows `⏹  Test stopped`.

- [ ] **Step 7: Commit**

```bash
git add src/components/RunConsole.tsx
git commit -m "feat(console): add Simple/Technical toggle and Simple rendering"
```

---

## Task 10: Polish + final sweep

**Files:**
- Possibly `src/components/RunConsole.tsx`, `src/components/FlowEditor.tsx`, design CSS file

- [ ] **Step 1: Verify run reset clears markers**

Run a flow to completion. Click Run again. The previous green markers should be cleared at the start of the second run (because `resetSteps()` is called in `onRun`/`onRunAll`).

If markers persist, check that Task 6 / Step 6 was applied correctly.

- [ ] **Step 2: Verify dark mode**

Toggle the app theme (Settings → Theme → Dark). Run a flow. Verify the gutter markers (green/red/blue) and the Simple mode console text remain readable. The Tailwind `dark:` variants on text colors should already cover this.

- [ ] **Step 3: Verify long-label alignment in Simple mode**

Open a flow with `assertVisible: "A very long string that exceeds the typical width"`. Run it. The label should truncate (`flex-1 truncate`) without pushing the duration column off-screen.

- [ ] **Step 4: Run the full test + lint + typecheck suite**

```bash
pnpm test && pnpm typecheck && pnpm lint
```

Expected: green across the board.

- [ ] **Step 5: Final commit (if any tweaks needed)**

```bash
git add -A
git commit -m "chore: polish run progress indicators and simple console"
```

If no tweaks were needed, skip this step.

---

## Notes for the implementer

- **The Tauri Rust runner is unchanged.** All work is in the TS frontend.
- **Maestro wording:** if the parser stops matching after a Maestro upgrade, the only file that needs editing is `src/lib/runStepParser.ts` — extend or adjust regexes there.
- **`runFlow` / `repeat` sub-flows:** out of scope. Sub-flow steps will not have markers; the parser will just see unmatched stdout lines and ignore them. The Simple console will not list sub-flow steps either. Documented limitation; do not attempt to fix in this plan.
- **`onRunAll`:** when running an entire folder, the AST snapshot uses the currently-open file's content. Steps for other flows in the folder won't match — that's acceptable for MVP; markers will simply not appear during cross-flow runs. A future plan can address per-file step tracking.
