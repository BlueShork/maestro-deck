# Run from here Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a right-click → "Run from line N" action in the YAML editor that runs the flow starting from a chosen instruction, without modifying the source file or breaking the existing Run button.

**Architecture:** A pure `buildPartialFlow` function truncates the YAML at the chosen line (preserving the preamble), produces a `lineMap` so step gutter markers still land on the original source lines, and an `onRunFrom` callback in `App.tsx` reuses the existing temp-file → `ipc.runFlow` → events pipeline. A native `oncontextmenu` handler in `FlowEditor.tsx` opens a Radix `DropdownMenu` with one item.

**Tech Stack:** TypeScript, React 18, CodeMirror 6, Radix DropdownMenu (existing wrapper at `src/components/ui/DropdownMenu.tsx`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-04-run-from-here-design.md`

---

## Task 1: `partialFlow.ts` — truncate flow at chosen line (TDD)

**Files:**
- Create: `src/lib/partialFlow.ts`
- Test: `src/lib/partialFlow.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/partialFlow.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildPartialFlow } from "./partialFlow";

const SOURCE = `appId: com.example
---
- launchApp
- tapOn: "Login"
- inputText: "user"
- tapOn: "Submit"
- assertVisible: "Welcome"
`;

describe("buildPartialFlow", () => {
  it("truncates from a step line, preserving preamble", () => {
    const r = buildPartialFlow(SOURCE, 5);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(
      `appId: com.example
---
- inputText: "user"
- tapOn: "Submit"
- assertVisible: "Welcome"
`,
    );
    expect(r!.firstStepOriginalLine).toBe(5);
    expect(r!.lineMap.get(1)).toBe(1);
    expect(r!.lineMap.get(2)).toBe(2);
    expect(r!.lineMap.get(3)).toBe(5);
    expect(r!.lineMap.get(4)).toBe(6);
    expect(r!.lineMap.get(5)).toBe(7);
  });

  it("returns the full source when clicking the first step line", () => {
    const r = buildPartialFlow(SOURCE, 3);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(SOURCE);
    expect(r!.firstStepOriginalLine).toBe(3);
  });

  it("returns null when clicking below the last step", () => {
    const r = buildPartialFlow(SOURCE, 99);
    expect(r).toBeNull();
  });

  it("snaps to the next step when clicking a non-step line", () => {
    const yaml = `appId: x
---
- launchApp
# a comment

- tapOn: "Submit"
`;
    const r = buildPartialFlow(yaml, 4);
    expect(r).not.toBeNull();
    expect(r!.firstStepOriginalLine).toBe(6);
  });

  it("works with no preamble (single-document flow)", () => {
    const yaml = `- launchApp\n- tapOn: "X"\n- assertVisible: "Y"\n`;
    const r = buildPartialFlow(yaml, 2);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(`- tapOn: "X"\n- assertVisible: "Y"\n`);
    expect(r!.firstStepOriginalLine).toBe(2);
    expect(r!.lineMap.get(1)).toBe(2);
    expect(r!.lineMap.get(2)).toBe(3);
  });

  it("preserves all preamble docs in multi-document sources", () => {
    const yaml = `helper: stuff
---
appId: com.example
---
- launchApp
- tapOn: "X"
`;
    const r = buildPartialFlow(yaml, 6);
    expect(r).not.toBeNull();
    expect(r!.content).toBe(
      `helper: stuff
---
appId: com.example
---
- tapOn: "X"
`,
    );
    expect(r!.firstStepOriginalLine).toBe(6);
  });

  it("returns null on invalid YAML", () => {
    const r = buildPartialFlow(`appId: x\n---\n- tapOn: [unclosed`, 3);
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/lib/partialFlow.test.ts`
Expected: FAIL (`Cannot find module './partialFlow'`).

- [ ] **Step 3: Implement `partialFlow.ts`**

Create `src/lib/partialFlow.ts`:

```ts
import { parseFlow } from "./flowAst";

export interface PartialFlow {
  content: string;
  lineMap: Map<number, number>;
  firstStepOriginalLine: number;
}

export function buildPartialFlow(
  source: string,
  fromLine: number,
): PartialFlow | null {
  const ast = parseFlow(source);
  if (ast.steps.length === 0) return null;

  const target = ast.steps.find((s) => s.line >= fromLine);
  if (!target) return null;

  const sourceLines = source.split("\n");
  const lastSeparatorIdx = findLastSeparator(sourceLines, target.line);

  const preambleLines: string[] =
    lastSeparatorIdx >= 0 ? sourceLines.slice(0, lastSeparatorIdx + 1) : [];

  const bodyStartIdx = target.line - 1;
  const bodyLines = sourceLines.slice(bodyStartIdx);

  const contentLines = [...preambleLines, ...bodyLines];
  const content = contentLines.join("\n");

  const lineMap = new Map<number, number>();
  for (let i = 0; i < preambleLines.length; i++) {
    lineMap.set(i + 1, i + 1);
  }
  for (let i = 0; i < bodyLines.length; i++) {
    lineMap.set(preambleLines.length + i + 1, bodyStartIdx + i + 1);
  }

  return {
    content,
    lineMap,
    firstStepOriginalLine: target.line,
  };
}

/**
 * Find the index of the last `---` line strictly before `targetLine`
 * (1-based). Returns -1 if none found, meaning the source has no
 * preamble.
 */
function findLastSeparator(sourceLines: string[], targetLine: number): number {
  for (let i = targetLine - 2; i >= 0; i--) {
    if (sourceLines[i].trim() === "---") return i;
  }
  return -1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/lib/partialFlow.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Run typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/partialFlow.ts src/lib/partialFlow.test.ts
git commit -m "feat(lib): add partialFlow for run-from-here YAML truncation"
```

---

## Task 2: `onRunFrom` callback in `App.tsx`

Add a new callback that mirrors `onRun` but uses `buildPartialFlow` and remaps step lines so gutter markers land on the original source lines. Existing `onRun` and `onRunAll` are NOT touched.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add the import**

In `src/App.tsx`, after the existing `import { parseFlow } from "@/lib/flowAst";` line (added in the previous feature), add:

```ts
import { buildPartialFlow } from "@/lib/partialFlow";
```

- [ ] **Step 2: Add the `onRunFrom` callback**

Add this callback right after the existing `onRunAll` callback (and before `onStop`):

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

- [ ] **Step 3: Pass `onRunFrom` to `<FlowEditor>`**

Find the `<FlowEditor />` JSX in `App.tsx` (it currently has no props) and change to:

```tsx
<FlowEditor onRunFrom={onRunFrom} />
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: an error in `App.tsx` because `FlowEditor` does not yet accept `onRunFrom`. This is expected — Task 3 fixes it.

If you also see other errors (unrelated), stop and report.

- [ ] **Step 5: Commit (with the type error pending)**

Do NOT commit yet. Move to Task 3 first; commit at the end of Task 3.

---

## Task 3: Context-menu wiring in `FlowEditor.tsx`

Adds a right-click handler that computes the clicked line, snaps to the next step at/below it, and opens a Radix `DropdownMenu` with a single "Run from line N" item.

**Files:**
- Modify: `src/components/FlowEditor.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/FlowEditor.tsx`, add:

```ts
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import { parseFlow } from "@/lib/flowAst";
```

(`useState` is likely already imported from React; if not, add it.)

- [ ] **Step 2: Accept the new prop**

Change the component signature from:

```tsx
export function FlowEditor() {
```

to:

```tsx
export function FlowEditor({ onRunFrom }: { onRunFrom?: (line: number) => void } = {}) {
```

- [ ] **Step 3: Add menu state**

Inside the `FlowEditor` component, after the existing `useState`/`useRef` hooks, add:

```ts
const [menu, setMenu] = useState<{ x: number; y: number; line: number } | null>(null);
```

- [ ] **Step 4: Add the context-menu handler**

Add a callback inside the component:

```ts
const onEditorContextMenu = useCallback(
  (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onRunFrom) return;
    const view = viewRef.current;
    if (!view) return;
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return;
    const clickedLine = view.state.doc.lineAt(pos).number;
    const ast = parseFlow(view.state.doc.toString());
    const target = ast.steps.find((s) => s.line >= clickedLine);
    if (!target) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, line: target.line });
  },
  [onRunFrom],
);
```

- [ ] **Step 5: Wire the handler onto the editor host and render the menu**

Find the `<div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />` line near the bottom of the component's JSX. Replace it with:

```tsx
<div
  ref={hostRef}
  className="min-h-0 flex-1 overflow-hidden"
  onContextMenu={onEditorContextMenu}
/>
{menu && onRunFrom ? (
  <DropdownMenu open onOpenChange={(open) => !open && setMenu(null)}>
    <DropdownMenuTrigger asChild>
      <span
        aria-hidden
        style={{
          position: "fixed",
          left: menu.x,
          top: menu.y,
          width: 0,
          height: 0,
          pointerEvents: "none",
        }}
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={0}>
      <DropdownMenuItem
        onSelect={() => {
          const line = menu.line;
          setMenu(null);
          onRunFrom(line);
        }}
      >
        Run from line {menu.line}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
) : null}
```

- [ ] **Step 6: Typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (The error from Task 2 Step 4 is now resolved because `FlowEditor` accepts the prop.)

- [ ] **Step 7: Run full tests**

Run: `pnpm test`
Expected: 38 tests pass (31 existing + 7 from Task 1).

- [ ] **Step 8: Commit Tasks 2 and 3 together**

```bash
git add src/App.tsx src/components/FlowEditor.tsx
git commit -m "feat(editor): add right-click 'Run from line' context menu"
```

---

## Task 4: Polish + verify

- [ ] **Step 1: Run the full quality suite**

```bash
pnpm typecheck && pnpm lint && pnpm test
```

Expected: all green.

- [ ] **Step 2: Manual smoke test**

Run: `pnpm tauri:dev`. Open a flow with at least 4 instructions. Right-click on the third instruction.

Expected:
- A small menu appears at the cursor with `Run from line N`.
- Clicking it starts a run; the gutter markers appear on the lines from N onward (NOT on lines before N).
- The console (Simple mode) lists only the steps from N onward.
- The summary shows the correct step count.
- Running the regular **Run** button afterwards executes the entire file as before.

- [ ] **Step 3: Smoke test edge cases**

- Right-click on a comment line BETWEEN two steps → menu shows "Run from line N" pointing at the next step below.
- Right-click on the line below the last step → no menu appears.
- Right-click on the `appId:` header line → menu shows "Run from line K" where K is the first step.

- [ ] **Step 4: If any tweaks were needed, commit them**

```bash
git add -A
git commit -m "chore: polish run-from-here"
```

If no tweaks, skip this step.

---

## Notes for the implementer

- **No Rust changes.** All work is in the TS frontend.
- **No `onRun` modifications.** The existing `onRun` and `onRunAll` callbacks remain byte-for-byte unchanged. Only NEW code is added.
- **The temp-file path is identical to `onRun`'s** (`<tempDir>/maestro-deck-flow.yaml`). This is intentional: each run reuses the same scratch file. There's no concurrency concern because the runner mutex is in `runStore`.
- **The `lineMap` is the magic that keeps gutter markers correct.** Without it, after truncating, `step.line === 1` would put a marker on line 1 of the source (the `appId:` header), not on the actual instruction line. The remap fixes that before `initSteps`.
