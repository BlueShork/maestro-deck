# Run from here — Design

**Date:** 2026-05-04
**Status:** Draft, pending user review

## Goal

Allow the user to right-click on a YAML instruction line and run the flow
**starting from that instruction**, without modifying the source file and
without re-running the steps before it.

The change must be purely additive: the existing **Run** button continues
to execute the entire file unchanged.

## Non-goals

- A "Run only this step" mode (running a single step in isolation).
- Detecting state dependencies (e.g. warning when the user skips
  `launchApp`). The spec from `2026-05-04-run-progress-indicators-design.md`
  already documents that step-state coherence is the user's responsibility.
- A hover button in the gutter. Right-click is the only entry point in MVP.
- Touching the Rust runner. Maestro's CLI does not support a partial-run
  flag, so the truncation happens in the frontend by writing a smaller
  YAML to a temp file.

## High-level architecture

```
right-click on editor line
        │
        ▼
context handler in FlowEditor.tsx
  - posAtCoords → 1-based line
  - parseFlow + find first step with line >= clicked
  - if no step found → no menu
        │
        ▼
DropdownMenu (Radix) at click coords
  - single item: "Run from line N"
        │
        ▼
onRunFrom(targetLine) prop callback in App.tsx
  - buildPartialFlow(content, targetLine) → { content, lineMap, firstStepOriginalLine }
  - write content to temp file (same path as onRun)
  - parseFlow(truncated) → remap step.line via lineMap → initSteps
  - ipc.runFlow(tempPath)
        │
        ▼
existing pipeline (gutter, Simple/Technical console) works unchanged
```

### New module

- `src/lib/partialFlow.ts` — pure function that truncates a flow YAML at
  a chosen line, preserving the preamble and emitting a line map back to
  the source so gutter markers land on the correct editor lines.

### Modified modules

- `src/components/FlowEditor.tsx` — add a context-menu handler and a
  `DropdownMenu` rendering, plus a new optional `onRunFrom?: (line: number)
  => void` prop.
- `src/App.tsx` — add a new `onRunFrom` callback alongside `onRun`,
  `onRunAll`, `onStop`. Pass it to `<FlowEditor>`. Existing callbacks
  unchanged.

### Unchanged

- `src-tauri/**` — no Rust changes.
- `runStore`, `RunConsole`, `flowStore`, `settingsStore` — no changes.
- `onRun`, `onRunAll`, `onStop` — no changes.
- The gutter, the Simple/Technical console toggle — no changes; the line
  remap ensures markers appear on the correct source lines.

## API: `partialFlow.ts`

```ts
export interface PartialFlow {
  /** YAML truncated content ready to write to a temp file. */
  content: string;
  /**
   * Maps a 1-based line number IN `content` to the corresponding 1-based
   * line number in the ORIGINAL source. Used to remap step markers in
   * the gutter so they appear on the correct editor lines.
   */
  lineMap: Map<number, number>;
  /** 1-based line in the original source where the truncated flow's first step lives. */
  firstStepOriginalLine: number;
}

export function buildPartialFlow(source: string, fromLine: number): PartialFlow | null;
```

### Rules

1. Parse `source` with `parseFlow(source)` (existing module). Take the
   resulting `Step[]`.
2. Find the **first step** with `step.line >= fromLine`. If none, return
   `null` — the menu item will be hidden.
3. Preserve the **preamble**: every line of the source up to and including
   the last `---` separator. If the source has no `---`, the preamble is
   empty.
4. Append the source lines from the first step's line to end-of-file
   verbatim. We copy raw lines (no YAML re-serialization) to preserve
   indentation, comments, anchors, and quoting style.
5. Build `lineMap`: for each line in the produced `content`, the line in
   the original source it came from. The preamble maps 1:1; the body
   lines map to their original positions.
6. Set `firstStepOriginalLine` to the line of the first matched step in
   the source.

### Example

Source:

```yaml
1  appId: com.example
2  ---
3  - launchApp
4  - tapOn: "Login"
5  - inputText: "user"
6  - tapOn: "Submit"
7  - assertVisible: "Welcome"
```

`buildPartialFlow(source, 5)` returns:

```yaml
1  appId: com.example
2  ---
3  - inputText: "user"
4  - tapOn: "Submit"
5  - assertVisible: "Welcome"
```

- `lineMap` = `{ 1→1, 2→2, 3→5, 4→6, 5→7 }`
- `firstStepOriginalLine` = `5`

### Edge cases

- **Source with no `---`** (single-document): preamble is empty, body
  starts at the matched step.
- **Multi-document source** (two or more `---`): preamble keeps everything
  through the **last** `---`. Earlier docs (e.g. helper definitions) come
  along.
- **Click on the exact line of a step**: that step is INCLUDED — run
  starts from there.
- **Click on a non-step line** (comment, blank, header, separator): snap
  to the next step at or below the clicked line. If none below, return
  `null`.
- **Invalid YAML**: `parseFlow` returns empty steps → `buildPartialFlow`
  returns `null` → the menu does not appear.

## UX: context menu

- A `MouseEvent` with `onContextMenu` on the editor host calls
  `e.preventDefault()` and computes the clicked line:

  ```ts
  const view = viewRef.current!;
  const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
  if (pos === null) return;
  const line = view.state.doc.lineAt(pos).number;
  ```

- Run `parseFlow(content)` and find the first step with `line >= clicked`.
  If none, do not open the menu.

- Open a Radix `DropdownMenu` with `modal={false}` and an explicit
  `open` state. Position it via the `Trigger`'s anchor — simplest:
  use `<DropdownMenuContent>` with absolute coordinates set on a
  zero-size invisible anchor positioned at the click point.

- The menu has a single item: `Run from line {N}` where `N` is the
  step's line in the source (so the user sees the snapped target).

- On select: call `props.onRunFrom(N)` and close the menu.

## Wiring in `App.tsx`

```ts
const onRunFrom = useCallback(
  async (line: number) => {
    const { content } = useFlowStore.getState();
    const partial = buildPartialFlow(content, line);
    if (!partial) return;
    try {
      const dir = await tempDir();
      const tempPath = `${dir.replace(/\/$/, "")}/maestro-deck-flow.yaml`;
      await writeTextFile(tempPath, partial.content);
      const truncatedAst = parseFlow(partial.content);
      const remappedSteps = truncatedAst.steps.map((s) => ({
        ...s,
        line: partial.lineMap.get(s.line) ?? s.line,
      }));
      resetSteps();
      initSteps(remappedSteps);
      const pid = await ipc.runFlow(tempPath);
      setRunning(pid);
      appendLog(
        "system",
        `[runner started pid ${pid} · from line ${partial.firstStepOriginalLine}]`,
      );
    } catch (err) {
      toast.error(
        "Run from here failed",
        err instanceof Error ? err.message : String(err),
      );
    }
  },
  [setRunning, appendLog, initSteps, resetSteps],
);
```

`<FlowEditor>` gains an optional prop `onRunFrom?: (line: number) => void`
and passes it to its context-menu handler.

## Testing strategy

Vitest unit tests in `src/lib/partialFlow.test.ts`. Pure-function
coverage:

1. Click on a step line → preamble + steps from that step.
2. Click on the first step line → produced content matches source.
3. Click on a line below the last step → returns `null`.
4. Click on a comment/blank line in the middle → snaps to next step.
5. Source without `---` → empty preamble, body starts at target step.
6. Multi-document source → preamble preserved through last `---`.
7. Invalid YAML → returns `null`.
8. `lineMap` correctness for the canonical example
   (`get(3) === 5`, `get(4) === 6`, `get(5) === 7`).
9. `firstStepOriginalLine` matches the snapped step.

No tests for the context menu DOM wiring or `App.tsx` integration —
costs more than it returns. The unit tests cover all non-trivial logic.

## Risks

- **`posAtCoords` accuracy**: returns the right position when the event
  comes from the editor itself, even when scrolled. Trusted.
- **Menu leaks if editor unmounts while open**: controlled by `onOpenChange`
  + closing on `onSelect`. Standard.
- **State dependency mismatches**: skipping `launchApp` and then trying
  to `tapOn` something inside the unlaunched app will fail. Documented as
  user responsibility — same caveat as in the run-progress-indicators
  spec. No warning UX in MVP.

## Implementation outline (single plan, 4 tasks)

1. `partialFlow.ts` + tests (TDD).
2. `onRunFrom` callback in `App.tsx`.
3. Context menu wiring in `FlowEditor.tsx`.
4. Polish + manual smoke test.
