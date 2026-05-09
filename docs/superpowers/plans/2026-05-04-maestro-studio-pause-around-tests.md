# Maestro Studio Pause/Resume Around Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the background `maestro studio` keeper before each test run so `maestro test` can talk to the on-device driver without a `dadb.TcpForwarder` timeout, then auto-restart the keeper in the background after the runner exits so inspect-mode performance stays unchanged.

**Architecture:** Extend `runner::spawn_runner` to accept an optional `on_exit` callback that fires after the runner subprocess exits. In `run_flow`, stop the studio keeper before spawning the runner, and pass an `on_exit` hook that schedules a background studio restart. No frontend changes.

**Tech Stack:** Rust (Tokio, Tauri 2 `AppHandle::state`), existing `StudioKeeper` infra in `hierarchy::studio`.

**Spec:** `docs/superpowers/specs/2026-05-04-maestro-studio-pause-around-tests-design.md`

---

## File Structure

**Modified files:**
- `src-tauri/src/runner/mod.rs` — `spawn_runner` gains an optional `on_exit` callback (`Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>`); the wait task fires it after PID removal, before emitting `runner:exit`. Existing callers can pass `None` (no behavior change).
- `src-tauri/src/hierarchy/studio.rs` — add `pub fn schedule_studio_restart(app: AppHandle)` that spawns a background task to re-warm the studio for the connected device.
- `src-tauri/src/ipc/commands.rs` — in `run_flow`, after pre-flight: take and stop the existing studio keeper, then pass an `on_exit` hook to `spawn_runner` that calls `schedule_studio_restart`.

No new files. No frontend changes. No new dependencies.

---

## Task 1: Extend `runner::spawn_runner` with an optional `on_exit` callback

**Files:** Modify `src-tauri/src/runner/mod.rs`.

- [ ] **Step 1: Update the function signature**

In `src-tauri/src/runner/mod.rs`, change the `spawn_runner` declaration from:

```rust
pub async fn spawn_runner(app: AppHandle, flow_path: &str) -> AppResult<u32> {
```

to:

```rust
pub async fn spawn_runner(
    app: AppHandle,
    flow_path: &str,
    on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>,
) -> AppResult<u32> {
```

- [ ] **Step 2: Fire the hook from the wait task**

Locate the existing wait task (around line 96–108):

```rust
    let app_exit = app.clone();
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });
```

Replace it with:

```rust
    let app_exit = app.clone();
    let on_exit_hook = on_exit;
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        // Fire the optional post-exit hook BEFORE emitting the exit event.
        // The hook may schedule background work (e.g. studio restart) that
        // we want kicked off as early as possible — the frontend doesn't
        // need to wait for it, since the hook just spawns and returns.
        if let Some(hook) = on_exit_hook {
            hook(app_exit.clone());
        }
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });
```

- [ ] **Step 3: Update the caller in `commands.rs` to pass `None` for now**

Locate `run_flow` in `src-tauri/src/ipc/commands.rs` (around line 383). Change the last line of the body from:

```rust
    runner::spawn_runner(app, &file_path).await
```

to:

```rust
    runner::spawn_runner(app, &file_path, None).await
```

(Task 3 will replace the `None` with the studio-restart hook. We pass `None` here so the build stays green between tasks.)

- [ ] **Step 4: Build**

Run: `cargo build --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml`
Expected: clean build.

- [ ] **Step 5: Run all maestro_health tests** (sanity — they shouldn't be affected)

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib maestro_health`
Expected: 24 passing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/runner/mod.rs src-tauri/src/ipc/commands.rs
git commit -m "feat(runner): on_exit callback fired after subprocess exit"
```

---

## Task 2: `schedule_studio_restart` helper

**Files:** Modify `src-tauri/src/hierarchy/studio.rs`.

- [ ] **Step 1: Add the helper at the end of the file**

Append to `src-tauri/src/hierarchy/studio.rs`:

```rust
/// Re-warm the `maestro studio` keeper for the currently-connected
/// device on a background tokio task. Safe to call from anywhere with an
/// `AppHandle`; never blocks and never returns an error to the caller.
///
/// Use this after a `maestro test` run completes so the next inspect
/// call hits the fast gRPC path instead of paying the ~10–15 s studio
/// startup cost.
///
/// If no device is connected when the task runs, it logs and returns —
/// the studio is meaningless without a target device.
pub fn schedule_studio_restart(app: tauri::AppHandle) {
    use tauri::Manager;

    tauri::async_runtime::spawn(async move {
        let state = app.state::<crate::state::AppState>();
        let serial = match state.connected_device.read().as_ref() {
            Some(d) => d.serial.clone(),
            None => {
                tracing::debug!("no device connected — skipping studio restart");
                return;
            }
        };
        match StudioKeeper::start(&serial).await {
            Ok(keeper) => {
                *state.studio.lock().await = Some(std::sync::Arc::new(keeper));
                tracing::info!(serial = %serial, "studio re-warmed after test");
            }
            Err(e) => {
                tracing::warn!(serial = %serial, error = ?e, "studio restart failed");
            }
        }
    });
}
```

`tauri::Manager` provides `app.state::<T>()`. Verify it's imported (or qualified as `use tauri::Manager;` inside the function). The function body uses fully-qualified paths (`crate::state::AppState`, `std::sync::Arc`) so it doesn't depend on imports at the top of the file beyond what's already there.

- [ ] **Step 2: Build**

Run: `cargo build --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml`
Expected: clean build. A `dead_code` warning on `schedule_studio_restart` is fine — Task 3 wires it.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/hierarchy/studio.rs
git commit -m "feat(studio): schedule_studio_restart background helper"
```

---

## Task 3: Wire pause + restart into `run_flow`

**Files:** Modify `src-tauri/src/ipc/commands.rs`.

- [ ] **Step 1: Update `run_flow`**

Locate `pub async fn run_flow(...)` in `src-tauri/src/ipc/commands.rs` (around line 383). The current body looks like:

```rust
#[tauri::command]
pub async fn run_flow(
    file_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<u32> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;

    let app_for_preflight = app.clone();
    let serial_for_preflight = serial.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::maestro_health::preflight_with_recovery(
            &app_for_preflight,
            &serial_for_preflight,
            "run_flow",
        );
    })
    .await
    .ok();

    runner::spawn_runner(app, &file_path, None).await
}
```

Replace it with:

```rust
#[tauri::command]
pub async fn run_flow(
    file_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<u32> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;

    // Pre-flight: kick a hung driver if needed (see preflight spec).
    let app_for_preflight = app.clone();
    let serial_for_preflight = serial.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::maestro_health::preflight_with_recovery(
            &app_for_preflight,
            &serial_for_preflight,
            "run_flow",
        );
    })
    .await
    .ok();

    // Stop the studio keeper so `maestro test` has exclusive access to
    // the driver and port 7001. Without this, the studio's adb forward
    // collides with `dadb.TcpForwarder` inside the test process and the
    // first launchApp times out. See:
    //   docs/superpowers/specs/2026-05-04-maestro-studio-pause-around-tests-design.md
    if let Some(keeper) = state.studio.lock().await.take() {
        keeper.stop().await;
    }

    // Schedule a background re-warm of the studio after the runner exits
    // so the next inspect call stays fast.
    let on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>> =
        Some(Box::new(|app: AppHandle| {
            crate::hierarchy::studio::schedule_studio_restart(app);
        }));

    runner::spawn_runner(app, &file_path, on_exit).await
}
```

- [ ] **Step 2: Build**

Run: `cargo build --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml`
Expected: clean build with no `dead_code` warnings on `schedule_studio_restart`.

- [ ] **Step 3: Run all maestro_health tests**

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib maestro_health`
Expected: 24 passing.

- [ ] **Step 4: Run all tests** (full sanity sweep)

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib`
Expected: all suites green.

- [ ] **Step 5: Frontend typecheck and lint**

Run:
```
cd /Users/ethanmorisset/maestro-deck && pnpm typecheck && pnpm lint
```
Expected: clean.

- [ ] **Step 6: Manual integration test (real device)**

The plan can't validate this without an Android device. Instructions for the human reviewer:

1. Open Maestro Deck (`pnpm tauri:dev`).
2. Connect an Android device.
3. Click Inspect once to spawn the studio keeper. Wait for the hierarchy to appear (~10–15 s the first time).
4. Run a Maestro flow that calls `launchApp`. The test should proceed past `Launch app` without the `dadb.TcpForwarder` timeout.
5. Watch the Maestro Deck logs (`tracing::info`). Within ~10–15 s of the runner exiting, the line `studio re-warmed after test` should appear.
6. Click Inspect ~30 s after the test ends. It should be fast (<1 s), confirming the studio is back online.
7. Click Inspect immediately after the test ends (before re-warm completes). It should still work via the CLI fallback (~3 s).
8. Run a second test back-to-back. Both should succeed without conflict.

If you cannot run the manual test in this environment, document that in your report — DO NOT claim manual verification.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/ipc/commands.rs
git commit -m "feat(runner): pause studio around test runs, re-warm after exit"
```

---

## Self-Review Notes

- **Spec coverage:**
  - Studio teardown before runner spawn (spec §Architecture step 1+2) → Task 3.
  - `schedule_studio_restart` background helper (spec §Restart hook) → Task 2.
  - `runner::spawn_runner` accepts `on_exit` callback fired from wait task (spec §New pieces) → Task 1.
  - Pre-flight from prior spec preserved and runs first (spec §Safety invariants) → Task 3 keeps the existing pre-flight block intact above the new studio stop.
  - Restart gated on `connected_device` presence (spec §Edge cases: device disconnected) → Task 2 inside `schedule_studio_restart`.
  - Stop is idempotent / no-op when no studio keeper held (spec §Edge cases: no studio running) → Task 3 uses `if let Some`.
  - Symmetrical Stop-mid-test handling (spec §Edge cases: user clicks Stop) → Task 1's wait task fires `on_exit` regardless of whether exit came from `child.wait()` or `kill_rx`.
- **Type / signature consistency:**
  - `runner::spawn_runner` new signature `(AppHandle, &str, Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>)` → Task 1 defines, Task 3 calls with the boxed closure.
  - `schedule_studio_restart(app: tauri::AppHandle)` → Task 2 defines, Task 3 calls with the same signature.
  - `state.studio: AsyncMutex<Option<Arc<StudioKeeper>>>` → Task 3 uses `state.studio.lock().await.take()`; Task 2 stores `Arc::new(keeper)` back. Matches.
- **Placeholder scan:** none.
- **Order check:** Task 1 (spawn_runner sig) must land before Task 3 (callsite uses new sig). Task 2 must land before Task 3 (Task 3 references `schedule_studio_restart`). Order in plan is 1 → 2 → 3, which matches. Each intermediate task leaves the build green (Task 1 passes `None`; Task 2 has a benign `dead_code` warning).
