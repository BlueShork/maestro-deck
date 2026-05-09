# YAML Autosave Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-persist edits to the active YAML flow 1 second after the user stops typing, gated by a user-toggleable setting and safe against in-flight writes and disk errors.

**Architecture:** A pure autosave *engine* (factory function) holds the debounce timer, in-flight flag, and disabled-on-error path; a thin React hook wires the engine to `flowStore` and `settingsStore` via vanilla zustand `subscribe`. Manual save / run paths are untouched and use the existing `flowStore.saved()` contract — the engine observes external `dirty: true → false` transitions to clear its disabled state.

**Tech Stack:** TypeScript, React 18, Zustand (with `persist` middleware), `@tauri-apps/plugin-fs` `writeTextFile`, Vitest (node env), existing `toastStore`.

---

## File Structure

- **Create** `src/lib/autosaveEngine.ts` — pure factory `createAutosaveEngine(deps)`. No React, no zustand imports. Owns the timer, in-flight flag, and disabled-paths set. Exposes `notifyChange()` and `dispose()`.
- **Create** `src/lib/autosaveEngine.test.ts` — vitest tests against the pure engine using fake timers and mocked deps.
- **Create** `src/lib/useAutosave.ts` — React hook. Subscribes to `useFlowStore` + `useSettingsStore` via vanilla `.subscribe`, builds an engine on mount, calls `engine.notifyChange()` on relevant store transitions, disposes on unmount.
- **Modify** `src/stores/settingsStore.ts` — add `autoSaveEnabled: boolean` (default `true`), `setAutoSaveEnabled`, include in `partialize`.
- **Modify** `src/components/SettingsDialog.tsx` — add a toggle row "Auto-save modified flows".
- **Modify** `src/components/FlowEditor.tsx` — call `useAutosave()` once at the top of the component body.

No changes to `flowStore.ts`, `App.tsx`, `onSave`, `onSaveAs`, `onRun`, `onRunAll`, or any other write-path.

---

## Task 1: Settings — `autoSaveEnabled` state

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Add the field, setter, default, and persist key**

In `src/stores/settingsStore.ts`, modify `interface SettingsState` to add (next to `fastHierarchyEnabled`):

```ts
  autoSaveEnabled: boolean;
```

And next to `setFastHierarchyEnabled`:

```ts
  setAutoSaveEnabled: (v: boolean) => void;
```

In the store body, next to `fastHierarchyEnabled: false,` add:

```ts
      autoSaveEnabled: true,
```

Next to `setFastHierarchyEnabled: ...` add:

```ts
      setAutoSaveEnabled: (autoSaveEnabled) => set({ autoSaveEnabled }),
```

In the `partialize` block, next to `fastHierarchyEnabled: s.fastHierarchyEnabled,` add:

```ts
        autoSaveEnabled: s.autoSaveEnabled,
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS, no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): add autoSaveEnabled flag (default on)"
```

---

## Task 2: Autosave engine — failing test for debounce coalescing

**Files:**
- Create: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Create the test file with a single failing test**

Write `src/lib/autosaveEngine.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAutosaveEngine, type AutosaveEngineDeps } from "./autosaveEngine";

function makeDeps(overrides: Partial<AutosaveEngineDeps> = {}): {
  deps: AutosaveEngineDeps;
  write: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
} {
  const write = vi.fn(async (_path: string, _content: string) => {});
  const onError = vi.fn((_message: string) => {});
  const deps: AutosaveEngineDeps = {
    write,
    onError,
    getFlow: () => ({ content: "a: 1", filePath: "/tmp/flow.yaml", dirty: true }),
    getEnabled: () => true,
    delayMs: 1000,
    ...overrides,
  };
  return { deps, write, onError };
}

describe("autosaveEngine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces rapid notifyChange calls into a single write", async () => {
    const { deps, write } = makeDeps();
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    vi.advanceTimersByTime(200);
    engine.notifyChange();
    vi.advanceTimersByTime(200);
    engine.notifyChange();
    expect(write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("/tmp/flow.yaml", "a: 1");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: FAIL — module `./autosaveEngine` not found.

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): debounce coalesces rapid edits into one write"
```

---

## Task 3: Autosave engine — minimal implementation to pass debounce test

**Files:**
- Create: `src/lib/autosaveEngine.ts`

- [ ] **Step 1: Create the engine module**

Write `src/lib/autosaveEngine.ts`:

```ts
export interface FlowSnapshot {
  content: string;
  filePath: string | null;
  dirty: boolean;
}

export interface AutosaveEngineDeps {
  write: (path: string, content: string) => Promise<void>;
  onError: (message: string) => void;
  getFlow: () => FlowSnapshot;
  getEnabled: () => boolean;
  delayMs: number;
}

export interface AutosaveEngine {
  notifyChange: () => void;
  notifyDirtyCleared: (path: string | null) => void;
  notifyPathChanged: (path: string | null) => void;
  dispose: () => void;
}

export function createAutosaveEngine(deps: AutosaveEngineDeps): AutosaveEngine {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  const disabled = new Set<string>();

  const flush = (): void => {
    timer = null;
    if (inFlight) return;
    if (!deps.getEnabled()) return;
    const { content, filePath, dirty } = deps.getFlow();
    if (!filePath || !dirty) return;
    if (disabled.has(filePath)) return;
    inFlight = true;
    deps
      .write(filePath, content)
      .catch((err: unknown) => {
        disabled.add(filePath);
        deps.onError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        inFlight = false;
      });
  };

  return {
    notifyChange(): void {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, deps.delayMs);
    },
    notifyDirtyCleared(path: string | null): void {
      if (path && !inFlight) disabled.delete(path);
    },
    notifyPathChanged(path: string | null): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (path) disabled.delete(path);
    },
    dispose(): void {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (1 test).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.ts
git commit -m "feat(autosave): debounced engine with in-flight guard"
```

---

## Task 4: Engine — `filePath === null` skip test

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the failing test**

Inside the existing `describe("autosaveEngine", () => { ... })` block in `src/lib/autosaveEngine.test.ts`, append:

```ts
  it("does not write when filePath is null", async () => {
    const { deps, write } = makeDeps({
      getFlow: () => ({ content: "a", filePath: null, dirty: true }),
    });
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (2 tests). The current implementation already handles this — the test guards against future regressions.

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): skip when no filePath"
```

---

## Task 5: Engine — `!dirty` skip test

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the test**

Append inside the same `describe`:

```ts
  it("does not write when dirty is false", async () => {
    const { deps, write } = makeDeps({
      getFlow: () => ({ content: "a", filePath: "/tmp/flow.yaml", dirty: false }),
    });
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): skip when not dirty"
```

---

## Task 6: Engine — disabled toggle skip test

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the test**

Append inside the same `describe`:

```ts
  it("does not write when getEnabled() returns false", async () => {
    const { deps, write } = makeDeps({ getEnabled: () => false });
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): skip when toggle is off"
```

---

## Task 7: Engine — in-flight skip test

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the test**

Append inside the same `describe`:

```ts
  it("skips a fire while a previous write is in flight", async () => {
    let resolveFirst: (() => void) | null = null;
    const write = vi.fn(
      (_path: string, _content: string) =>
        new Promise<void>((resolve) => {
          if (resolveFirst === null) {
            resolveFirst = resolve;
          } else {
            resolve();
          }
        }),
    );
    const { deps } = makeDeps({ write });
    const engine = createAutosaveEngine(deps);

    // First save is now in-flight, never resolves.
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    // Second debounce while first is still pending — must skip.
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    // Resolve the first; a subsequent edit must save again.
    resolveFirst?.();
    await Promise.resolve();
    await Promise.resolve();
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): skip while previous write is in flight"
```

---

## Task 8: Engine — error disables autosave for that path; manual save re-enables

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the test**

Append inside the same `describe`:

```ts
  it("disables autosave for a path after a write error and re-enables on external dirty-clear", async () => {
    const flow: { content: string; filePath: string | null; dirty: boolean } = {
      content: "a",
      filePath: "/tmp/flow.yaml",
      dirty: true,
    };
    const write = vi
      .fn<(path: string, content: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("EACCES"));
    const onError = vi.fn();
    const engine = createAutosaveEngine({
      write,
      onError,
      getFlow: () => flow,
      getEnabled: () => true,
      delayMs: 1000,
    });

    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("EACCES");

    // Subsequent edits to the same path must NOT trigger a write.
    flow.content = "b";
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(1);

    // Simulate manual save: dirty -> false externally; engine is told.
    flow.dirty = false;
    engine.notifyDirtyCleared(flow.filePath);
    flow.dirty = true;
    flow.content = "c";
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("/tmp/flow.yaml", "c");
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): disable on error, re-enable on external save"
```

---

## Task 9: Engine — `notifyPathChanged` clears disabled flag and pending timer

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the test**

Append inside the same `describe`:

```ts
  it("notifyPathChanged cancels pending timer and clears disabled flag for the new path", async () => {
    const flow: { content: string; filePath: string | null; dirty: boolean } = {
      content: "a",
      filePath: "/tmp/old.yaml",
      dirty: true,
    };
    const write = vi
      .fn<(path: string, content: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("EACCES"))
      .mockResolvedValue(undefined);
    const onError = vi.fn();
    const engine = createAutosaveEngine({
      write,
      onError,
      getFlow: () => flow,
      getEnabled: () => true,
      delayMs: 1000,
    });

    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);

    // Switch to a new file. Pending timer (none here) cancelled, disabled cleared.
    flow.filePath = "/tmp/new.yaml";
    engine.notifyPathChanged(flow.filePath);

    flow.content = "z";
    engine.notifyChange();
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenLastCalledWith("/tmp/new.yaml", "z");
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): path change cancels timer and clears disabled flag"
```

---

## Task 10: Engine — `dispose` cancels pending timer

**Files:**
- Modify: `src/lib/autosaveEngine.test.ts`

- [ ] **Step 1: Add the test**

Append inside the same `describe`:

```ts
  it("dispose prevents a pending timer from firing", async () => {
    const { deps, write } = makeDeps();
    const engine = createAutosaveEngine(deps);
    engine.notifyChange();
    engine.dispose();
    await vi.advanceTimersByTimeAsync(2000);
    expect(write).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the test**

Run: `pnpm vitest run src/lib/autosaveEngine.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 3: Commit**

```bash
git add src/lib/autosaveEngine.test.ts
git commit -m "test(autosave): dispose cancels pending timer"
```

---

## Task 11: React hook `useAutosave`

**Files:**
- Create: `src/lib/useAutosave.ts`

- [ ] **Step 1: Write the hook**

Write `src/lib/useAutosave.ts`:

```ts
import { useEffect } from "react";
import { writeTextFile } from "@tauri-apps/plugin-fs";

import { createAutosaveEngine } from "@/lib/autosaveEngine";
import { useFlowStore } from "@/stores/flowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { toast } from "@/stores/toastStore";

const AUTOSAVE_DELAY_MS = 1000;

export function useAutosave(): void {
  useEffect(() => {
    const engine = createAutosaveEngine({
      write: async (path, content) => {
        await writeTextFile(path, content);
        useFlowStore.getState().saved(path);
      },
      onError: (message) => toast.error("Auto-save failed", message),
      getFlow: () => {
        const s = useFlowStore.getState();
        return { content: s.content, filePath: s.filePath, dirty: s.dirty };
      },
      getEnabled: () => useSettingsStore.getState().autoSaveEnabled,
      delayMs: AUTOSAVE_DELAY_MS,
    });

    let lastContent = useFlowStore.getState().content;
    let lastFilePath = useFlowStore.getState().filePath;
    let lastDirty = useFlowStore.getState().dirty;

    const unsubscribeFlow = useFlowStore.subscribe((s) => {
      if (s.filePath !== lastFilePath) {
        lastFilePath = s.filePath;
        engine.notifyPathChanged(s.filePath);
      }
      if (lastDirty && !s.dirty) {
        engine.notifyDirtyCleared(s.filePath);
      }
      lastDirty = s.dirty;
      if (s.content !== lastContent) {
        lastContent = s.content;
        engine.notifyChange();
      }
    });

    return () => {
      unsubscribeFlow();
      engine.dispose();
    };
  }, []);
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/useAutosave.ts
git commit -m "feat(autosave): React hook wiring engine to flow + settings stores"
```

---

## Task 12: Mount the hook in `FlowEditor`

**Files:**
- Modify: `src/components/FlowEditor.tsx`

- [ ] **Step 1: Add the import**

In `src/components/FlowEditor.tsx`, in the import block near the other `@/lib/...` imports, add:

```ts
import { useAutosave } from "@/lib/useAutosave";
```

- [ ] **Step 2: Call the hook at the top of the component**

Locate `export function FlowEditor(...)` (around line 150). Immediately after the line:

```ts
  const saved = useFlowStore((s) => s.saved);
```

add:

```ts
  useAutosave();
```

- [ ] **Step 3: Verify typecheck and existing tests still pass**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/FlowEditor.tsx
git commit -m "feat(editor): mount autosave hook in FlowEditor"
```

---

## Task 13: Settings dialog toggle

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

- [ ] **Step 1: Read the new state from the store**

In `src/components/SettingsDialog.tsx`, after the line:

```ts
  const fastHierarchyEnabled = useSettingsStore((s) => s.fastHierarchyEnabled);
  const setFastHierarchyEnabled = useSettingsStore((s) => s.setFastHierarchyEnabled);
```

add:

```ts
  const autoSaveEnabled = useSettingsStore((s) => s.autoSaveEnabled);
  const setAutoSaveEnabled = useSettingsStore((s) => s.setAutoSaveEnabled);
```

- [ ] **Step 2: Add the toggle row**

In the same file, locate the existing FPS row:

```tsx
          <div className="flex items-center justify-between">
            <span>Show FPS counter</span>
            <Switch checked={showFps} onCheckedChange={setShowFps} aria-label="Show FPS counter" />
          </div>
```

Immediately **before** that block, insert:

```tsx
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <span>Auto-save modified flows</span>
              <span className="text-[11px] text-muted-foreground">
                Automatically saves the open YAML 1 second after you stop typing.
              </span>
            </div>
            <Switch
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
              aria-label="Auto-save modified flows"
            />
          </div>
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsDialog.tsx
git commit -m "feat(settings): toggle for auto-save modified flows"
```

---

## Task 14: Full verification

- [ ] **Step 1: Run the entire test suite**

Run: `pnpm test`
Expected: PASS — all existing tests plus the 8 new `autosaveEngine` tests.

- [ ] **Step 2: Lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Manual smoke test**

Run: `pnpm tauri:dev`

Open a `.yaml` flow from the workspace, type a few characters, wait ~1 second, observe via the OS file inspector or `stat` that the file's mtime updated. Toggle the setting off in `Settings`, edit again, confirm no mtime update. Toggle on again, edit, confirm mtime updates. Try editing the default unsaved buffer (no `filePath`) and confirm no auto-save happens.

If anything in the smoke test is unexpected, stop and report — do not proceed.

- [ ] **Step 4: No commit needed** (verification-only task).
