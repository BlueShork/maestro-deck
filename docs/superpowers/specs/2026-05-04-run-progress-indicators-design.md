# Run progress indicators + Simple/Technical console — Design

**Date:** 2026-05-04
**Status:** Draft, pending user review

## Goal

While a Maestro test is running, the user should see, at a glance, which YAML
instruction is currently executing, which have already executed, and which
failed. Additionally, the run console should offer a friendly "Simple" mode for
testers who do not need raw runner output, while keeping the existing verbose
output available as a "Technical" mode.

The change must not break any existing behavior. All UI text is in English.

## Non-goals

- Inlining steps from `runFlow`/`repeat` sub-flows (out of scope for MVP;
  documented as a known limitation).
- Replacing the existing run pipeline (`runner:stdout`/`stderr`/`exit` events
  from `src-tauri/src/runner/mod.rs` are unchanged).
- E2E browser tests of the gutter or the console toggle.

## High-level architecture

A single event pipeline drives both features:

```
maestro stdout ──► Tauri event ──► runner:stdout
                                       │
                          ┌────────────┴────────────┐
                          ▼                         ▼
                  raw log buffer           StepEventParser
                  (runStore.logs)          (lib/runStepParser.ts)
                                                     │
                                                     ▼
                                          StepEvent { kind, command, arg }
                                                     │
                                  ┌──────────────────┼──────────────────┐
                                  ▼                                     ▼
                         FlowAst.matchStep                       runStore.steps
                         (lib/flowAst.ts; reparsed                (per-index state:
                          on flowStore.content                     pending/running/
                          change, debounced 200ms)                 done/failed)
                                  │                                     │
                                  ▼                                     ▼
                          runStore.steps[i].line          RunConsole
                                  │                       (Simple mode reformats;
                                  ▼                        Technical mode shows
                          FlowEditor gutter                raw logs as today)
                          (new gutter left of
                           line numbers)
```

### New modules (frontend only, no Rust changes)

- `src/lib/flowAst.ts` — parses YAML to `Step[] = { index, line, command, arg }`.
  Reparsed on `flowStore.content` change with a 200 ms debounce. Uses `js-yaml`
  (new dependency) for reliable line positions including anchors and multi-doc.
- `src/lib/runStepParser.ts` — pure `parseLine(line: string): StepEvent | null`.
  Recognizes `Launch app "X"...`, `Tap on "X"...`, `Assert that "X" is visible...`,
  etc., and the `COMPLETED`/`FAILED` suffixes.
- `src/lib/stepRenderer.ts` — pure `formatStep(step, status, durationMs): string`
  for the Simple console mode.

### Modified modules

- `src/stores/runStore.ts` — adds `steps: StepRunState[]`, gains `initSteps`,
  `applyEvent`, `resetSteps`.
- `src/stores/settingsStore.ts` — adds `consoleMode: "simple" | "technical"`
  (default `"simple"`).
- `src/components/FlowEditor.tsx` — adds a new CodeMirror gutter to the left
  of the line-numbers gutter, reading `runStore.steps`.
- `src/components/RunConsole.tsx` — adds a Simple/Technical segmented toggle
  in the header and switches rendering branch based on `consoleMode`.

## Data structures

### `flowAst.ts`

```ts
export interface Step {
  index: number;        // order in the flow (0-based)
  line: number;         // 1-based YAML line where the command starts
  command: string;      // "launchApp" | "tapOn" | "assertVisible" | ...
  arg: string | null;   // primary argument normalized for matching
                        // (e.g., "com.openai.chatgpt" for launchApp,
                        //  "Login" for tapOn, "ChatGPT" for assertVisible)
}

export interface FlowAst {
  steps: Step[];
  // command|arg → step indices; an array because the same pair can appear
  // multiple times in the flow.
  byKey: Map<string, number[]>;
}

export function parseFlow(yaml: string): FlowAst;
```

Invalid YAML returns `{ steps: [], byKey: new Map() }` — no throw, no error
toast. The user is probably mid-edit.

### `runStepParser.ts`

```ts
export type StepEventKind = "started" | "completed" | "failed";

export interface StepEvent {
  kind: StepEventKind;
  command: string;
  arg: string | null;
  /** present only when kind === "failed" */
  error?: string;
}

export function parseLine(line: string): StepEvent | null;
```

Regex table, one per Maestro command (≈15 entries; easy to extend):

```
/^Launch app "(.+?)"\.\.\. (COMPLETED|FAILED)/
/^Tap on "(.+?)"\.\.\. (COMPLETED|FAILED)/
/^Assert that "(.+?)" is visible\.\.\. (COMPLETED|FAILED)/
/^Input text "(.+?)"\.\.\. (COMPLETED|FAILED)/
...
```

A line of the form `Launch app "X"...` without the trailing `COMPLETED|FAILED`
yields `kind: "started"`. Unknown lines return `null` (system messages, banners,
unrecognized commands — all silently ignored).

### `runStore` extensions

```ts
export type StepStatus = "pending" | "running" | "done" | "failed";

export interface StepRunState {
  index: number;
  line: number;
  command: string;
  arg: string | null;
  status: StepStatus;
  startedAt: number | null;   // performance.now()
  durationMs: number | null;
  error: string | null;
}

interface RunState {
  // ... existing fields ...
  steps: StepRunState[];
  initSteps: (steps: Step[]) => void;     // called when a run starts
  applyEvent: (e: StepEvent) => void;     // matching + state transition
  resetSteps: () => void;
}
```

`consoleMode` lives in `settingsStore` (single source of truth); `RunConsole`
reads it via a selector. This avoids duplicating persistence logic.

### Matching algorithm in `applyEvent`

```
1. key = `${event.command}|${event.arg ?? ""}`
2. indices = ast.byKey.get(key)
3. cases:
   - 0 candidates  → ignore the event (command not present in the AST)
   - 1 candidate   → direct match
   - N candidates  → take the first one whose status === "pending"
                     (sequential fallback for duplicates)
4. state transitions:
   - "started"    → pending → running, startedAt = now()
   - "completed"  → running → done, durationMs = now() - startedAt
   - "failed"     → running → failed, error = event.error
```

## UI rendering

### CodeMirror gutter (left of line numbers, fixed 14 px width)

```
┌──┬────┬─────────────────────────┐
│ ●│  1 │ appId: com.example.app  │
│  │  2 │ ---                     │
│ ✓│  3 │ - launchApp             │   ← step done (green)
│ ◐│  4 │ - tapOn: "Login"        │   ← step running (animated loader)
│  │  5 │ - inputText: "..."      │   ← step pending (empty)
│ ✗│  6 │ - assertVisible: "..."  │   ← step failed (red)
└──┴────┴─────────────────────────┘
```

Markers per status:

- `pending` → empty
- `running` → 8 px SVG loader, CSS `@keyframes spin`
- `done` → 8 px filled circle, `bg-emerald-500`
- `failed` → 8 px cross, `text-red-500`

Implementation: a `StateField` mapping `runStore.steps[].line → status`, and a
`gutter({ class: "cm-step-status", lineMarker: ... })`. The store pushes
changes via a `StateEffect` (mirroring the existing `setActiveLine` pattern in
`FlowEditor.tsx`). No re-render when nothing changes — perf is non-issue at
the data volumes involved.

Hover on the marker: native `title` tooltip (e.g., `Failed: Element not found
after 8s`) for failed steps. No custom tooltip (YAGNI).

Persistence after run end: markers stay until the next `setRunning()`, which
calls `resetSteps()` and rebuilds from the current AST.

### Console toggle

Header layout (added between "running" badge and Perf/Clear/Stop):

```
┌─────────────────────────────────────────────────────────────────┐
│ CONSOLE  ● running    [Simple|Technical]   [Perf] [Clear] [Stop]│
├─────────────────────────────────────────────────────────────────┤
```

Toggle = two segmented `Button size="xs"` elements; the active mode renders as
`variant="default"`, the inactive as `variant="ghost"`. Click calls
`settingsStore.setConsoleMode(...)`.

### Simple mode rendering

When `consoleMode === "simple"`, `RunConsole` does not iterate over
`runStore.logs`; it iterates over `runStore.steps`:

```tsx
{steps.map((s) => <StepLine key={s.index} step={s} />)}
{exitCode !== null && <SummaryLine />}
```

`StepLine` format (single line, monospace, fixed-width columns):

```
   {icon}  {humanLabel(step)}{padding}{duration}
```

- `icon`: `▶` (running, animated), `✓` (done, green), `✗` (failed, red),
  ` ` (pending, gray)
- `humanLabel` (table in `stepRenderer.ts`):
  - `launchApp` + `"X"` → `Open X app`
  - `tapOn` + `"X"` → `Tap "X"`
  - `assertVisible` + `"X"` → `Check that "X" is visible`
  - `inputText` + `"X"` → `Type "X"`
  - etc. Unknown commands → fallback to raw YAML string.
- `duration`: `1.2s`, right-aligned at column 40. While `running`, a small
  pulse replaces the duration.

`SummaryLine`:

- exit 0 + 0 failed → `✅  Test passed — N steps in T.Ts` (green)
- exit ≠ 0 OR failed step → `❌  Test failed at step K` (red)
- killed (`stopRequested`) → `⏹  Test stopped`

### Technical mode rendering

Unchanged from today: iterates over `runStore.logs`. The
`[runner started ...]` and `[runner exited ...]` system lines continue to be
appended as `stream === "system"`.

### Live mode switching

The toggle does **not** touch the runner and does **not** clear anything.
Both `runStore.logs` and `runStore.steps` are populated in parallel during
each run, so toggling Technical ↔ Simple mid-run instantly re-renders the
same data in the other format.

## Behavior details

- **Default console mode**: `"simple"`. Power users toggle to Technical
  themselves and the choice is persisted.
- **End of run**: green markers persist until the next run; failed step gets
  red ✗; unreached steps stay empty (matches the user-confirmed "option C").
- **Invalid YAML mid-run**: AST stays empty, no markers appear, run continues
  normally with raw logs in Technical mode.
- **YAML edits during a run**: if `flowStore.content` changes during a run,
  we do **not** reparse — the AST captured at run start is the source of
  truth for that run, otherwise step indices would shift under us.

## Memory

For a typical flow (≤ 50 steps), `runStore.steps` adds ~5 KB.
`runStore.logs` is already capped at 2000 lines. No risk.

## Testing strategy

Vitest unit tests, fast and pure-logic:

1. `src/lib/flowAst.test.ts`
   - simple flow → command/arg/line correct
   - flow with two identical `tapOn: "Login"` → 2 entries in `byKey`
   - invalid YAML → empty result, no throw
   - multi-document flow (`---`) → no crash, lines correct

2. `src/lib/runStepParser.test.ts`
   - `Launch app "X"... COMPLETED` → `{ kind: "completed", command: "launchApp", arg: "X" }`
   - `Tap on "Login"...` (no suffix) → `{ kind: "started", ... }`
   - `Assert that "Y" is visible... FAILED` → `{ kind: "failed", ... }`
   - system lines (`Running on R3CX...`, `[runner started ...]`) → `null`
   - covers ~15 common Maestro commands (table-driven)

3. `src/lib/stepRenderer.test.ts`
   - each known command produces correct human label
   - unknown command → fallback to raw `command + arg`
   - duration formatting (`1.2s`, `12.4s`, `<0.1s`)

4. `src/stores/runStore.test.ts`
   - `initSteps` then `applyEvent("started"/"completed")` → correct transitions
   - 2 identical steps + 2 `completed` events → first done, then second done
     (sequential fallback on ambiguity)
   - event for a command absent from the AST → silently ignored

No E2E test of CodeMirror rendering or the console toggle — cost too high vs
value. Pure functions cover the logic; the rendering layer is thin.

## Implementation breakdown (5 mergeable steps)

1. **Foundations** — no visible UI change.
   - Add `js-yaml` (+ `@types/js-yaml`).
   - `src/lib/flowAst.ts` + tests.
   - `src/lib/runStepParser.ts` + tests.
   - `src/lib/stepRenderer.ts` + tests.

2. **Extend `runStore`** — no visible UI change.
   - `steps`, `initSteps`, `applyEvent`, `resetSteps`.
   - Store tests.
   - Wire into the existing Tauri stdout handler: each line → `parseLine` →
     if non-null, `applyEvent`. On run start: `parseFlow(content)` →
     `initSteps`.

3. **CodeMirror gutter** — first visible feature.
   - New gutter in `FlowEditor.tsx` reading `runStore.steps`.
   - 4 markers (empty / spinner / green check / red cross) + CSS animation.
   - Native tooltip on failed.
   - Manual test: real flow with 2-3 instructions, verify live transitions.

4. **Console toggle + Simple mode** — second visible feature.
   - `consoleMode` in `settingsStore` (default `"simple"`).
   - Segmented Simple/Technical button in `RunConsole.tsx`.
   - Simple rendering branch over `runStore.steps`.
   - `SummaryLine` (success/fail/stopped).
   - Manual test: toggle mid-run both ways; no events lost.

5. **Polish.**
   - Verify reset on next run clears markers.
   - Verify column alignment in Simple with long labels.
   - Test a failing flow (assert on missing element) → markers + summary
     coherent.
   - Verify dark mode for green/red.

## Risks

- **Maestro wording changes**: if a Maestro release renames `Tap on "X"...`
  → `Tap "X"...`, the parser silently breaks (events become `null`).
  Mitigation: the regex table is centralized in one file, easy to patch.
  No crashes, just no markers.
- **`js-yaml` bundle weight** (~40 KB gzip). Acceptable given the central
  role of YAML in the app.
- **Flows with `runFlow`/`repeat`**: not covered in MVP — referenced
  sub-flows are not inlined, so their steps get no markers. Documented as
  a known limitation, not a bug.
