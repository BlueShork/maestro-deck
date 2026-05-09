# Maestro studio pause/resume around tests — design

**Date:** 2026-05-04
**Scope:** Stop the background `maestro studio` keeper before spawning a `maestro test` run, and auto-restart it in the background after the test exits, so test runs no longer conflict with the studio over port 7001 / the on-device driver — without losing the inspect-mode performance the studio provides.

**Builds on:**
- `docs/superpowers/specs/2026-05-04-maestro-device-healthcheck-design.md` (manual healthcheck)
- `docs/superpowers/specs/2026-05-04-maestro-driver-preflight-design.md` (auto pre-flight)

## Problem

Maestro Deck spawns a long-lived `maestro studio` subprocess (`StudioKeeper`) when the user enters inspect mode, then keeps it alive to make subsequent hierarchy dumps fast (~500ms instead of ~3s). This studio holds an exclusive grip on the on-device driver and the host-side `tcp:7001` adb forward.

When the user clicks **Run**, the runner spawns `maestro test <flow>` as a separate subprocess. Both processes try to talk to the driver via port 7001. Symptom observed in real logs:

```
maestro.Maestro.launchApp: Launching app com.openai.chatgpt
maestro.Maestro.launchApp: Stopping com.openai.chatgpt app during launch
[ERROR] launchAppCommand: Failed to launch app
java.util.concurrent.TimeoutException: null
    at dadb.forwarding.TcpForwarder.waitFor
    at dadb.forwarding.TcpForwarder.start
    at maestro.drivers.AndroidDriver.allocateForwarder
    at maestro.drivers.AndroidDriver.open
```

`dadb` (Maestro's adb library) tries to allocate a forwarder for the test session, the studio is already holding the resources, and `dadb` times out. The test fails before the first command runs. Bypass: closing Maestro Deck and running `maestro test` from a clean shell — confirmed working in user testing.

## Goal

When the user runs a test from inside Maestro Deck:

1. Tear down the studio keeper completely before spawning the test process. Test runs with the same clean state as a fresh CLI invocation.
2. After the test exits (regardless of success/failure), kick off a background studio restart so the next inspect call is fast again.
3. Observable user behavior: tests work, inspect performance is preserved, no extra clicks or waits introduced.

Out of scope: studio handling for non-test driver workloads, iOS, configurable opt-out.

## Architecture

### Existing pieces we reuse

- `AppState::studio: AsyncMutex<Option<Arc<StudioKeeper>>>` — already holds the live keeper, if any.
- `StudioKeeper::stop(&self)` — already idempotent: kills the child, removes the adb forward, force-stops the on-device driver. Exactly the teardown we need.
- `StudioKeeper::start(serial: &str) -> AppResult<Arc<Self>>` — already exists; produces a fresh keeper.
- `runner::spawn_runner(app, flow_path) -> AppResult<u32>` — spawns `maestro test`, returns PID, internally tokio-spawns a wait task that emits `runner:exit`.

### New pieces

A small helper `runner::on_exit(pid, hook)` registered alongside the kill channel. When the wait task removes the PID from `RUNNERS`, it also fires the hook (if any) before emitting `runner:exit`. The hook is a `Box<dyn FnOnce(AppHandle) + Send + 'static>`.

In `commands::run_flow`:
1. `let keeper = state.studio.lock().await.take();` (slot is now empty)
2. `if let Some(k) = keeper { k.stop().await; }` (waits for child reap + forward removal)
3. Spawn the runner with an `on_exit` hook that schedules a studio restart.

### Restart hook

A standalone function in `hierarchy::studio` (or a small new module `hierarchy::studio_restart`):

```rust
pub fn schedule_studio_restart(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let state = app.state::<AppState>();
        let serial = match state.connected_device.read().as_ref() {
            Some(d) => d.serial.clone(),
            None => return, // device disconnected during the test — skip
        };
        match StudioKeeper::start(&serial).await {
            Ok(keeper) => {
                *state.studio.lock().await = Some(keeper);
                tracing::info!(serial = %serial, "studio re-warmed after test");
            }
            Err(e) => {
                tracing::warn!(serial = %serial, error = ?e, "studio restart failed");
            }
        }
    });
}
```

The hook passed to `runner::on_exit` calls this function. Failure is logged but not surfaced to the UI: the inspect path already has a CLI fallback that doesn't depend on the studio.

## Sequence

```
user clicks "Run"
    ↓
run_flow handler:
    1. preflight_with_recovery (existing)
    2. stop studio keeper (NEW): take from state, call .stop(), drop
    3. spawn_runner with on_exit hook
       returns pid → frontend
    ↓
runner subprocess runs
    ↓
runner wait task:
    - tokio::select! { child.wait() | kill_rx }
    - on_exit hook fires (NEW): schedule_studio_restart(app.clone())
    - emit runner:exit (existing)
    ↓
schedule_studio_restart task (background):
    - read connected_device
    - StudioKeeper::start(serial)
    - store back in state.studio
```

## Why pause-then-restart, not "share the studio with the test"

Maestro CLI is opinionated: it expects exclusive access to the driver and reuses port 7001 by default. There's no published API for "share an existing studio session with a parallel test". Pause/resume is the only contract-safe option.

## Edge cases

| Case                                              | Behavior                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| No studio running when run starts                 | Step 2 is a no-op (`take()` returns `None`); proceed normally.           |
| Studio start happened to be in flight (rare race) | `state.studio.lock()` serializes — we either get the keeper or `None`.   |
| User clicks Stop mid-test                         | `kill_runner` already triggers the wait task's cleanup → on_exit still fires → studio restarts. Symmetrical and correct. |
| Device disconnected during test                   | `schedule_studio_restart` reads `connected_device`, sees `None`, returns. No error. |
| Studio restart fails (adb gone, driver crashes)   | Logged via `tracing::warn`. Next inspect call hits the CLI fallback (~3s). |
| User runs a second test back-to-back              | First test's exit triggers restart; second test's `run_flow` calls `stop()` again. The second `stop()` may interrupt a half-warm studio mid-startup — handled by `StudioKeeper::stop`'s idempotency guarantee. |

## Safety invariants

- The studio teardown reuses the existing, already-tested `StudioKeeper::stop`. No new kill paths.
- The restart only runs if a device is connected, gated on `state.connected_device`.
- The `on_exit` hook is `FnOnce` — fires exactly once per runner.
- No new whitelists; package and port already hardcoded inside `StudioKeeper`.
- Pre-flight from the prior spec still runs first; the new studio stop happens between pre-flight and runner spawn. No interaction between the two.

## Testing

### Rust unit tests

- `runner::on_exit` registration and firing — fake out the wait task by triggering kill_rx and asserting the hook ran. Keeps coverage for the new code path.
- `schedule_studio_restart` is hard to unit-test (depends on `StudioKeeper::start` which talks to adb). Skip — covered by manual integration test.

### Manual integration tests (real device)

1. Run a test in Maestro Deck → studio is stopped, test proceeds, `launchApp` succeeds (no `dadb.TcpForwarder` timeout).
2. Right after the test, observe `tracing::info` log "studio re-warmed after test" within ~10–15s.
3. Click Inspect ~30s after the test → fast path (<1s).
4. Click Inspect immediately after the test (before re-warm finishes) → CLI fallback fires, ~3s. Acceptable.
5. Disconnect device mid-test → restart task sees no device, exits silently. App stays usable.
6. Run two tests back-to-back → both pass; no port conflict between them.

### Out of scope

- Automated end-to-end (impractical in CI for this repo).
- iOS.

## File-level summary of changes

- `src-tauri/src/runner/mod.rs` — extend `spawn_runner` to accept an optional `on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>` and invoke it from the wait task after PID removal, before emitting `runner:exit`.
- `src-tauri/src/hierarchy/studio.rs` — add `pub fn schedule_studio_restart(app: AppHandle)`.
- `src-tauri/src/ipc/commands.rs` — in `run_flow`, after pre-flight: `take()` and `stop()` the studio, then call `spawn_runner` with an `on_exit` hook that calls `schedule_studio_restart(app.clone())`.

No frontend changes. No new types exposed to the IPC layer. No new dependencies.
