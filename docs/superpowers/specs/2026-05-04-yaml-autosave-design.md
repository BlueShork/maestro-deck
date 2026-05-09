# YAML autosave for the flow editor

**Date:** 2026-05-04
**Status:** Approved (design)

## Problem

Editing a flow YAML in `FlowEditor` only persists to disk on explicit save
(`Cmd/Ctrl+S`, the toolbar action, or implicitly when launching a run). Anything
typed between two saves lives only in the zustand `flowStore` — closing the app
or crashing loses the edit, and runs that bypass the save path can read stale
content from disk.

## Goal

Auto-persist edits to the currently open YAML file shortly after the user stops
typing, without changing the rest of the editor's behavior, and without
introducing perceivable lag or save-storm I/O.

## Non-goals

- Auto-creating a file for an unsaved buffer (`filePath === null`). Untitled
  buffers stay in memory until the user picks a path via "Save As".
- Auto-saving anything other than the active flow (no workspace-wide sweeper, no
  multi-buffer queue — there is only one active buffer in the store today).
- Versioning, conflict resolution, or atomic temp-file writes. The existing
  manual save uses `writeTextFile` directly; autosave matches that contract.

## Behavior

### Trigger

- 1000 ms debounce after the last `setContent` call.
- Fires only when **all** of these hold at the moment the timer elapses:
  - `dirty === true`
  - `filePath !== null`
  - the autosave setting is enabled
  - no autosave write is currently in flight for this file
  - autosave has not been disabled-on-error for this file path
- Any new `setContent` call resets the timer (standard trailing debounce).

### Concurrency

A single in-flight flag is held inside the autosave hook. If the timer fires
while a previous write has not resolved, the attempt is **skipped**, not queued.
The next `setContent` will reschedule the debounce, so the most recent content
is what gets written when the in-flight save completes. This avoids head-of-line
queue buildup and guarantees at most one outstanding `writeTextFile` per buffer.

### Race with manual save / run

- `onSave`, `onSaveAs`, `onRun`, and `onRunAll` all read `useFlowStore.getState()`
  at call time and write directly. They do **not** consult the autosave
  in-flight flag. This is intentional: a user-initiated save must never be
  blocked. Two writes to the same path may overlap; the OS-level last-write-wins
  semantics match what already happens today between `onRun` and a fast
  `Cmd+S`.
- After any successful write (manual or auto), `flowStore.saved(filePath)` is
  called — `dirty` returns to `false`, the autosave timer becomes a no-op until
  the next edit.

### Error handling

If `writeTextFile` rejects:

1. Show a single `toast.error("Auto-save failed", message)`.
2. Mark autosave **disabled for this file path** in hook-local state. No further
   automatic writes happen for this `filePath`.
3. The flag clears when `filePath` changes (open another file) **or** when
   `dirty` transitions to `false` while no autosave write is in flight — i.e.
   some other code path (manual `onSave`, `onSaveAs`, `onRun`, `onRunAll`)
   successfully wrote the file, which proves the path is writable again.

The `dirty` flag stays `true` so the existing visual indicator keeps warning
the user. No retry loop, no toast spam.

### File path change

When `filePath` changes (open / save-as / close), the autosave hook:

- Cancels any pending debounce timer.
- Drops the disabled-on-error state for the old path.
- Does **not** flush the previous file — the `loaded` action sets `dirty: false`,
  so there is nothing to flush; `saveDialog` flows go through `onSaveAs` which
  writes synchronously before swapping the path.

### Settings

A new boolean in `settingsStore`: `autoSaveEnabled` (default `true`).

- Persisted via the existing `persist` middleware (same pattern as `showFps`).
- Surfaced in `SettingsDialog` as a toggle labeled
  **"Auto-save modified flows"** with a one-line description:
  *"Automatically saves the open YAML 1 second after you stop typing."*
- No delay configurability in v1. 1000 ms is hardcoded.

## Architecture

### New file: `src/lib/useAutosave.ts`

A custom hook with this shape:

```ts
export function useAutosave(): void;
```

It is mounted once inside `FlowEditor` (the only component that hosts the YAML
buffer today). The hook:

- Subscribes to `flowStore` for `content`, `filePath`, `dirty`.
- Subscribes to `settingsStore` for `autoSaveEnabled`.
- Owns a `setTimeout` ref, an `inFlight` ref, and a `disabledForPath` ref.
- On every relevant change, schedules / cancels the debounce.
- On timer fire, performs the gated write described above.
- Cleans up the timer on unmount and on `filePath` change.

The hook does **not** expose state. The user-visible `dirty` indicator is
already driven by `flowStore`; reusing `saved(filePath)` keeps everything in
sync.

### Touched files

- `src/stores/settingsStore.ts` — add `autoSaveEnabled` + setter, default `true`.
- `src/components/SettingsDialog.tsx` — new toggle row.
- `src/lib/useAutosave.ts` — new hook (the autosave engine).
- `src/components/FlowEditor.tsx` — mount `useAutosave()` once at the top of
  the component body.

No changes to `flowStore.ts`, `App.tsx`, `onRun`, `onRunAll`, or any other
write-path. The `dirty` / `saved()` contract is reused as-is.

## Tests

`src/lib/useAutosave.test.ts` (vitest, node env, fake timers):

1. **Debounce coalesces edits**: 5 rapid `setContent` calls within 200 ms ⇒
   exactly one `writeTextFile` after advancing 1000 ms.
2. **No write when `filePath === null`**: edits to an untitled buffer never
   call `writeTextFile`.
3. **No write when `!dirty`**: setting content equal to current content keeps
   `dirty` false, no write.
4. **No write when toggle is off**: `autoSaveEnabled = false` ⇒ no writes
   regardless of edits.
5. **In-flight skip**: while a `writeTextFile` promise is unresolved, a second
   debounce fire does not call `writeTextFile` again. After the first resolves
   and a new edit lands, a write happens.
6. **Error disables autosave for that path**: `writeTextFile` rejects once ⇒
   one `toast.error` call, subsequent edits to the same path produce no further
   write attempts. Switching `filePath` re-enables autosave.
7. **Cleanup on unmount**: pending timer is cleared, no write fires after
   unmount.

`writeTextFile` and `toast` are mocked via `vi.mock`. Timers are advanced with
`vi.useFakeTimers()` / `vi.advanceTimersByTime`.

## Risks and rollback

- **Hidden disk activity**: a user who relied on "nothing is saved until I hit
  Cmd+S" loses that property. Mitigated by the toggle (default on, easy to
  flip off) and by the existing dirty indicator continuing to behave the same
  way at rest.
- **Write storms on slow disks**: bounded by the in-flight skip — at most one
  outstanding write per buffer, so worst case is "saves lag behind typing"
  rather than "queue grows".
- **Rollback**: revert the four touched files. `flowStore` is untouched, so
  there is no migration to undo.
