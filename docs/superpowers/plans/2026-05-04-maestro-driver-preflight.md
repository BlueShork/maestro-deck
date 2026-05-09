# Maestro Driver Pre-flight Auto-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transparent pre-flight TCP ping of the Maestro driver before `run_flow` and `enter_inspect_mode`, with a silent kill+forward-remove auto-recovery and a brief toast when recovery happens.

**Architecture:** Two new private helpers (`ping_driver`, `recover_driver`) and one orchestrator (`preflight_with_recovery`) live in the existing `maestro_health` module. The two affected Tauri command handlers gain a single call to the orchestrator at the top. Frontend listens for two new Tauri events to show/hide a toast.

**Tech Stack:** Rust (`std::net::TcpStream::connect_timeout`), Tauri 2 events, React + Zustand toast store, existing `adb` infra from `maestro_health`.

**Spec:** `docs/superpowers/specs/2026-05-04-maestro-driver-preflight-design.md`

---

## File Structure

**Modified files:**
- `src-tauri/src/maestro_health/detect.rs` — add `ping_driver` and `ping_driver_at` (testable variant taking a port).
- `src-tauri/src/maestro_health/kill.rs` — add `recover_driver` (private wrapper around existing `force_stop_driver` + `do_unforward`).
- `src-tauri/src/maestro_health/mod.rs` — add `preflight_with_recovery` orchestrator (emits Tauri events, calls ping/recover).
- `src-tauri/src/ipc/commands.rs` — call `preflight_with_recovery` at the top of `run_flow` and `enter_inspect_mode`. Add `state: State<'_, AppState>` to `run_flow`'s signature (it currently doesn't have it; needed to look up the connected device's serial).
- `src/App.tsx` (or wherever event listeners are wired) — register listeners for `driver-recovering` / `driver-recovered`.

No new files.

---

## Task 1: `ping_driver` — TCP liveness probe

**Files:** Modify `src-tauri/src/maestro_health/detect.rs`.

- [ ] **Step 1: Write failing tests**

Append inside the existing `tests` module in `src-tauri/src/maestro_health/detect.rs`:

```rust
    use std::net::TcpListener;

    #[test]
    fn ping_driver_at_succeeds_when_port_listens() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        // Hold the listener open for the duration of the test so connect()
        // succeeds. We don't accept() — `connect_timeout` only needs the
        // SYN/ACK handshake which the kernel handles before accept.
        assert!(ping_driver_at(port, 1_000));
        drop(listener);
    }

    #[test]
    fn ping_driver_at_fails_when_no_listener() {
        // Bind then immediately drop, so the port is almost certainly
        // unbound by the time we connect. Connection refused = false.
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        assert!(!ping_driver_at(port, 200));
    }
```

- [ ] **Step 2: Run tests — should fail to compile**

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib maestro_health::detect::tests`
Expected: compilation error "cannot find function `ping_driver_at`".

- [ ] **Step 3: Implement `ping_driver_at` and `ping_driver`**

Add to `detect.rs` (above the `tests` module). Add `use std::net::{SocketAddr, TcpStream};` and `use std::time::Duration;` to the top of the file (merge with existing imports — `Command` is already imported from `std::process`):

```rust
/// Probe a TCP port on localhost. Returns `true` if the port accepts a
/// connection within `timeout_ms`, `false` otherwise. Used to detect a
/// hung Maestro driver: when the gRPC server stops responding, the
/// kernel-level connect either refuses or times out.
fn ping_driver_at(port: u16, timeout_ms: u64) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)).is_ok()
}

/// Ping the standard Maestro driver port (forwarded by `adb forward`).
pub fn ping_driver(timeout_ms: u64) -> bool {
    ping_driver_at(super::MAESTRO_DRIVER_PORT, timeout_ms)
}
```

- [ ] **Step 4: Run tests**

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib maestro_health::detect::tests`
Expected: all tests pass (existing 14 + 2 new = 16).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/maestro_health/detect.rs
git commit -m "feat(health): TCP ping helper for maestro driver liveness"
```

---

## Task 2: `recover_driver` — kill + unforward primitive

**Files:** Modify `src-tauri/src/maestro_health/kill.rs`.

- [ ] **Step 1: Add `recover_driver`**

Append in `src-tauri/src/maestro_health/kill.rs` (above the `tests` module, after `do_kill_pid`):

```rust
/// Best-effort recovery: force-stop the driver and remove the standard
/// port forward. Errors are logged but not returned — callers (the
/// pre-flight wrapper) continue regardless because `maestro` will surface
/// its own error if the device is genuinely unusable.
pub fn recover_driver(device_id: &str) {
    let bin = adb_bin();

    // 1. force-stop the driver app. Hardcoded package name; never read
    //    from external input.
    match Command::new(&bin)
        .args([
            "-s",
            device_id,
            "shell",
            "am",
            "force-stop",
            MAESTRO_DRIVER_PACKAGE,
        ])
        .output()
    {
        Ok(o) if o.status.success() => {
            tracing::info!(device = %device_id, "force-stopped maestro driver");
        }
        Ok(o) => {
            tracing::warn!(
                device = %device_id,
                stderr = %String::from_utf8_lossy(&o.stderr),
                "force-stop failed during recovery"
            );
        }
        Err(e) => {
            tracing::warn!(device = %device_id, error = %e, "force-stop errored");
        }
    }

    // 2. remove the standard port forward. Hardcoded port; never read
    //    from external input.
    let arg = format!("tcp:{}", MAESTRO_DRIVER_PORT);
    match Command::new(&bin)
        .args(["-s", device_id, "forward", "--remove", &arg])
        .output()
    {
        Ok(o) if o.status.success() => {
            tracing::info!(device = %device_id, port = MAESTRO_DRIVER_PORT, "removed port forward");
        }
        Ok(_) => {
            // Often "listener not found" — benign if no forward existed.
            tracing::debug!(device = %device_id, "forward --remove returned non-zero (likely no listener)");
        }
        Err(e) => {
            tracing::warn!(device = %device_id, error = %e, "forward --remove errored");
        }
    }
}
```

`tracing` is already imported and used elsewhere in the project; if the file doesn't currently import it, add `use tracing;` near the top (or qualified `tracing::info!` works without a `use` since it's a macro from the crate).

- [ ] **Step 2: Verify build**

Run: `cargo build --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml`
Expected: clean build. A `dead_code` warning on `recover_driver` is fine — Task 3 wires it up.

- [ ] **Step 3: Run all maestro_health tests**

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib maestro_health`
Expected: 24 passing (the prior 22 from the healthcheck feature + 2 new ping tests from Task 1).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/maestro_health/kill.rs
git commit -m "feat(health): recover_driver wraps force-stop + unforward"
```

---

## Task 3: `preflight_with_recovery` — orchestrator emitting Tauri events

**Files:** Modify `src-tauri/src/maestro_health/mod.rs`.

- [ ] **Step 1: Add the orchestrator**

Append at the bottom of `src-tauri/src/maestro_health/mod.rs`:

```rust
use serde::Serialize as _; // already imported above; harmless re-import note

use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
struct DriverRecoveringPayload<'a> {
    device_id: &'a str,
    action: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct DriverRecoveredPayload<'a> {
    device_id: &'a str,
}

/// Pre-flight check before any operation that depends on the Maestro
/// gRPC driver. If the driver port responds within `PING_TIMEOUT_MS`,
/// returns immediately. Otherwise emits `driver-recovering`, runs the
/// recovery (kill driver + remove forward), and emits `driver-recovered`.
///
/// `action` is an opaque tag (e.g. "run_flow", "inspect") forwarded in
/// the event payload so the frontend can phrase the toast appropriately
/// or distinguish concurrent flows.
///
/// Never returns an error: recovery failure is non-fatal — the caller
/// proceeds and lets the underlying maestro CLI surface its own error
/// if the device is genuinely unusable.
pub fn preflight_with_recovery(app: &AppHandle, device_id: &str, action: &'static str) {
    const PING_TIMEOUT_MS: u64 = 2_000;

    if detect::ping_driver(PING_TIMEOUT_MS) {
        return;
    }

    tracing::info!(device = %device_id, action, "driver ping failed — recovering");

    let _ = app.emit(
        "driver-recovering",
        DriverRecoveringPayload { device_id, action },
    );

    kill::recover_driver(device_id);

    let _ = app.emit(
        "driver-recovered",
        DriverRecoveredPayload { device_id },
    );
}
```

**Note on imports:** `serde::Serialize` is already imported at the top of `mod.rs` (used by `HealthReport`). Don't duplicate; if Rust complains about the trailing `use serde::Serialize as _;` line, just delete it — the prior `use serde::{Deserialize, Serialize};` already brings the trait into scope.

`tauri::Emitter` is the trait that gives `AppHandle::emit` in Tauri 2. Add the `use tauri::{AppHandle, Emitter};` line as shown.

- [ ] **Step 2: Verify build**

Run: `cargo build --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml`
Expected: clean build (warning on `preflight_with_recovery` being dead code is fine — Task 4 wires it).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/maestro_health/mod.rs
git commit -m "feat(health): preflight_with_recovery emits tauri events"
```

---

## Task 4: Wire pre-flight into `run_flow` and `enter_inspect_mode`

**Files:** Modify `src-tauri/src/ipc/commands.rs`.

- [ ] **Step 1: Pre-flight `enter_inspect_mode`**

Locate `pub async fn enter_inspect_mode(...)` (around line 185). After the existing serial extraction block:

```rust
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;
```

Add immediately below it:

```rust
    // Pre-flight: if the on-device driver isn't responding, force-stop
    // it and remove the port forward so the next maestro call spawns a
    // fresh driver instead of hanging for 120s on DEADLINE_EXCEEDED.
    let app_for_preflight = app.clone();
    let serial_for_preflight = serial.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::maestro_health::preflight_with_recovery(
            &app_for_preflight,
            &serial_for_preflight,
            "inspect",
        );
    })
    .await
    .ok();
```

This runs the (potentially blocking) ping + adb commands on the blocking pool, matching the pattern the file already uses for the CLI hierarchy dump. `enter_inspect_mode` already takes an `app: AppHandle` somewhere in its body — verify that the function signature includes `app: AppHandle` as a parameter; if not, add it. Tauri injects `AppHandle` automatically when declared.

**Important — read the current signature first.** If `enter_inspect_mode` takes `app: AppHandle` already (likely it doesn't), use it. If not, add `app: AppHandle` to the parameter list. Verify the call site is fine — Tauri commands are routed by name, parameters injected by type, so adding `app: AppHandle` is non-breaking for the frontend.

- [ ] **Step 2: Pre-flight `run_flow`**

Locate `pub async fn run_flow(file_path: String, app: AppHandle)` (around line 367). It does NOT currently take `state`, so it has no access to the connected device's serial. Add `state: State<'_, AppState>` to the signature:

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

    runner::spawn_runner(app, &file_path).await
}
```

(`AppState` and `State` are already imported at the top of `commands.rs` — used by other handlers. No new imports.)

- [ ] **Step 3: Verify build**

Run: `cargo build --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml`
Expected: clean build. The `dead_code` warning on `preflight_with_recovery` should now disappear.

- [ ] **Step 4: Run all health tests**

Run: `cargo test --manifest-path /Users/ethanmorisset/maestro-deck/src-tauri/Cargo.toml --lib maestro_health`
Expected: 24 passing.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/ipc/commands.rs
git commit -m "feat(health): preflight before run_flow and inspect_mode"
```

---

## Task 5: Frontend — toast on `driver-recovering` / `driver-recovered`

**Files:** Modify `src/App.tsx` (top-level effect to register listeners).

- [ ] **Step 1: Read the existing event-listener pattern**

Open `/Users/ethanmorisset/maestro-deck/src/App.tsx` and find where `listen(...)` (from `@tauri-apps/api/event`) is used to register existing listeners (e.g. for runner events / metrics events). The new listener must follow the same teardown pattern (return `unlisten()` from `useEffect`).

- [ ] **Step 2: Add the listener effect**

In `App.tsx`, alongside the existing `useEffect`s that register Tauri listeners, add:

```tsx
useEffect(() => {
  let toastId: string | null = null;
  const unlistenRecovering = listen<{ device_id: string; action: string }>(
    "driver-recovering",
    () => {
      // dismiss any prior recovery toast in case events arrive out of order
      if (toastId) {
        useToastStore.getState().dismiss(toastId);
      }
      toastId = useToastStore.getState().push({
        title: "Recovering driver…",
        description: "Maestro driver was unresponsive — restarting it.",
        variant: "default",
        persistent: true,
      });
    },
  );
  const unlistenRecovered = listen<{ device_id: string }>(
    "driver-recovered",
    () => {
      if (toastId) {
        useToastStore.getState().dismiss(toastId);
        toastId = null;
      }
    },
  );
  return () => {
    void unlistenRecovering.then((u) => u());
    void unlistenRecovered.then((u) => u());
    if (toastId) {
      useToastStore.getState().dismiss(toastId);
    }
  };
}, []);
```

Add the import at the top of `App.tsx` if not already present:

```tsx
import { listen } from "@tauri-apps/api/event";
import { useToastStore } from "@/stores/toastStore";
```

(`useEffect` is already imported in `App.tsx`.)

The `persistent: true` flag on the toast prevents the auto-dismiss timer from racing with the `driver-recovered` event. The `recovered` listener explicitly calls `dismiss(toastId)`.

- [ ] **Step 3: Verify typecheck and lint**

Run:
```
cd /Users/ethanmorisset/maestro-deck && pnpm typecheck && pnpm lint
```
Expected: clean.

- [ ] **Step 4: Manual sanity check (no device required)**

The listener registration is harmless without a device. Verify the app still boots:
```
pnpm tauri:dev
```
Expected: app opens, no console errors related to the new listeners. Close it.

If you cannot run `tauri:dev` (e.g., headless), skip and document in your report.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(health): toast on driver pre-flight recovery events"
```

---

## Self-Review Notes

- **Spec coverage:**
  - `ping_driver` (spec §Backend) → Task 1.
  - `recover_driver` (spec §Backend) → Task 2.
  - `preflight_with_recovery` orchestrator + Tauri events (spec §Pre-flight wrapper) → Task 3.
  - Wired into `run_flow` and `enter_inspect_mode` (spec §Tauri command integration) → Task 4.
  - Frontend toast listener (spec §Frontend) → Task 5.
  - Safety invariants 1–5 (spec §Safety invariants) — preserved automatically: `recover_driver` only invokes `am force-stop dev.mobile.maestro` and `forward --remove tcp:7001`, both hardcoded; `preflight_with_recovery` runs once per call (no loop); recovery errors are logged not returned.
- **Type / signature consistency:**
  - `ping_driver(timeout_ms: u64) -> bool` — used in Task 3 with `2_000`. Matches.
  - `recover_driver(device_id: &str)` (returns `()`) — Task 2 defines, Task 3 calls. Matches.
  - `preflight_with_recovery(app: &AppHandle, device_id: &str, action: &'static str)` — Task 3 defines, Task 4 calls with `"inspect"` and `"run_flow"`. Matches.
  - Event names: `"driver-recovering"` and `"driver-recovered"` — same in Rust emit (Task 3) and TS listen (Task 5).
  - Event payload field `device_id` — same on both sides.
- **Placeholder scan:** none.
- **Plan covers all spec sections.**
