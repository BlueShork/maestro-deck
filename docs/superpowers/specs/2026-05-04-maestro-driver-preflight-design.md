# Maestro driver pre-flight auto-recovery — design

**Date:** 2026-05-04
**Scope:** Add a transparent pre-flight check before each test run / inspection that pings the Maestro driver, and auto-recovers (kill driver + clear port forward) if the ping fails — so users don't hit the 120s `DEADLINE_EXCEEDED` symptom from a hung driver.

**Builds on:** `docs/superpowers/specs/2026-05-04-maestro-device-healthcheck-design.md` (manual healthcheck button). The manual button stays; this spec adds an automatic path on top.

## Problem

The Maestro driver app on Android (`dev.mobile.maestro`) sometimes ends up in a half-dead state: the process exists, but its gRPC server on `tcp:7001` no longer accepts connections. Symptom: any Maestro CLI call (test, inspect, hierarchy dump) hangs for ~120s before failing with `io.grpc.StatusRuntimeException: DEADLINE_EXCEEDED`. The user is left waiting two minutes for nothing.

Today the only fix is to manually `am force-stop dev.mobile.maestro` and re-run. The freshly-added healthcheck button helps, but the user has to know to click it. This spec makes the recovery happen automatically.

## Goal

Before each Maestro Deck operation that depends on the driver (`run_flow`, `enter_inspect_mode`):

1. Quickly probe the driver (TCP ping on `127.0.0.1:7001`, 2s timeout).
2. If it responds → proceed normally, no UI noise.
3. If it doesn't → silently kill the driver app + clear the port forward, surface a brief toast, and proceed. Maestro will spawn a fresh driver on its first command.

The user clicks "Run" once and either gets an instant launch (healthy case) or a ~1s recovery toast followed by launch (unhealthy case). They never wait 120s, never see a stack trace, never have to think about driver state.

Out of scope: reactive recovery on test failure, iOS, recovery-failure retry loops.

## Architecture

### Backend additions (Rust)

Two new functions inside the existing `src-tauri/src/maestro_health` module — same module that hosts the manual healthcheck, same safety invariants.

- `detect::ping_driver(timeout_ms: u64) -> bool` — opens a `TcpStream` to `127.0.0.1:7001` with a connect timeout. Returns `true` on success, `false` on any error (timeout, connection refused, etc.). No logging of failure as an error — failure is the expected trigger for recovery.

- `kill::recover_driver(device_id: &str) -> AppResult<()>` — internal helper that runs `am force-stop dev.mobile.maestro` followed by `adb forward --remove tcp:7001`. Reuses the existing whitelist constants (`MAESTRO_DRIVER_PACKAGE`, `MAESTRO_DRIVER_PORT`); no new whitelisting surface introduced.

Both functions are private to the module; the only consumer is the pre-flight wrapper.

### Pre-flight wrapper

A small helper, also inside `maestro_health`:

```rust
pub fn preflight_with_recovery(
    app: &AppHandle,
    device_id: &str,
    action: &'static str,
)
```

Behavior:

1. `if ping_driver(2_000) { return; }` — happy path.
2. Otherwise:
   - `app.emit("driver-recovering", { device_id, action })`
   - `recover_driver(device_id)` — errors are logged but **not propagated** (the user can still try the action; `maestro` will fail with its own message if the device is genuinely unusable).
   - `app.emit("driver-recovered", { device_id })`

### Tauri command integration

The two relevant handlers in `src-tauri/src/ipc/commands.rs` — `run_flow` and `enter_inspect_mode` — gain a single line near the top:

```rust
maestro_health::preflight_with_recovery(&app, &serial, "run_flow");
```

No other handler is touched. `connect_device`, `list_devices`, scrcpy commands, etc. don't depend on the Maestro driver's gRPC and don't need pre-flight.

### Frontend

A small effect in the existing toast / device store layer listens for the two new events:

```typescript
listen("driver-recovering", () => toast.info("Recovering driver…"));
listen("driver-recovered", () => toast.dismissId("driver-recovering"));
```

If the project's toast API doesn't support dismiss-by-id, the simplest fallback is a 3s auto-dismiss toast — the recovery is fast enough that it'll be gone by the time the user looks. (Implementation detail to confirm during plan-writing.)

The manual stethoscope button from the previous feature is unchanged.

## Safety invariants

These are inherited from the manual healthcheck and remain non-negotiable:

1. **Package whitelist:** the only package killed is `dev.mobile.maestro`.
2. **Port whitelist:** the only port unforwarded is `7001`.
3. **No `pm clear`:** v1 never wipes driver app data.
4. **One recovery per run:** `preflight_with_recovery` runs once per `run_flow` / `enter_inspect_mode` call. We don't loop or retry. If the test still fails after the recovery, the error surfaces normally — that's the user's signal that the problem isn't a zombie driver.
5. **Recovery failure is non-fatal:** if `am force-stop` itself errors (adb gone, device offline), we log and continue. `maestro` will fail with its own clear message rather than us blocking the launch with our own error.

## Detection cost in the happy path

`TcpStream::connect_timeout` to a listening local port returns in ~1–10ms. The 2s timeout only kicks in when the driver is actually hung. Compared to the current 120s `DEADLINE_EXCEEDED`, the worst case becomes ~2s ping + ~1s kill + normal driver relaunch ≈ ~3–4s total recovery.

## Error handling

| Condition                              | Behavior                                                            |
| -------------------------------------- | ------------------------------------------------------------------- |
| Ping succeeds                          | No event, no toast, proceed.                                        |
| Ping fails, recovery succeeds          | `recovering` toast, then dismissed; test launches normally.         |
| Ping fails, `am force-stop` errors     | Recovery error logged via `tracing::warn`; toast still dismissed; test launches; if it fails, user sees the maestro error as before. |
| `adb` not on PATH at preflight time    | Same as above — log + continue. Existing `AppError::AdbNotFound` will surface from `list_devices` / `connect_device` paths long before we get here. |

## Testing

### Rust unit tests

- `ping_driver` returns `true` against a local `TcpListener` bound to `127.0.0.1:0` (the test creates the listener, swaps in its port, and asserts).
- `ping_driver` returns `false` against a port no one listens on (timeout path).
- `recover_driver` is pure command wiring; reuses already-tested helpers (`force_stop_driver`, `do_unforward`). No additional unit test needed.
- `preflight_with_recovery` is orchestration; covered by integration testing.

### Manual integration tests (real device)

1. Healthy driver → click Run → test launches with no toast.
2. Hung driver (force the case via `adb shell am crash dev.mobile.maestro` or by killing host-side `maestro` mid-run) → click Run → "Recovering driver…" toast appears for ~1s → test launches normally.
3. adb missing / device offline → graceful failure (no Maestro Deck crash, error surfaces from the maestro subprocess as before).

### Out of scope

- Automated end-to-end on device (impractical in CI for this repo).
- iOS — same boundary as the previous spec.

## File-level summary of changes

- `src-tauri/src/maestro_health/detect.rs` — add `ping_driver`.
- `src-tauri/src/maestro_health/kill.rs` — add `recover_driver` (private helper combining existing primitives).
- `src-tauri/src/maestro_health/mod.rs` — add `preflight_with_recovery` orchestrator.
- `src-tauri/src/ipc/commands.rs` — call `preflight_with_recovery` near the top of `run_flow` and `enter_inspect_mode`.
- `src/lib/ipc.ts` (or the equivalent event-listener layer) — register listeners for `driver-recovering` / `driver-recovered`.
- `src/stores/toastStore.ts` — possibly extend with `dismissId` if not already supported (verify during plan writing).

No changes to: existing healthcheck button, device list flow, scrcpy, settings, types.
