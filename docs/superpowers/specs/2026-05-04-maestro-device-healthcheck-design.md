# Maestro device healthcheck — design

**Date:** 2026-05-04
**Scope:** Detect and kill leftover Maestro processes on a connected Android device, from the Maestro Deck UI, without restarting the desktop app.

## Problem

When Maestro crashes mid-run, residual artifacts can remain on the connected Android device:

- The Maestro driver app (`dev.mobile.maestro`) keeps running.
- The `adb` port forward (typically `tcp:7001`) stays mapped.
- An orphan instrumentation process keeps running with no client.

Today the only fix is `pkill -f maestro` on the host machine (which only addresses host-side processes, not the device-side residue) or manually running `adb` commands. This is unfriendly for end users.

## Goal

Provide a one-click healthcheck in the Maestro Deck UI that:

1. Detects whether any of the three residual artifacts above is present on a selected Android device.
2. Surfaces what was found in a confirmation modal.
3. Lets the user kill the detected processes — and only those — with a single click.
4. Never affects unrelated apps, processes, or ports.

Out of scope for v1: iOS, multi-device batch healthcheck, automatic detection (reactive triggers on test failure), automatic relaunch of the driver after kill.

## Architecture

### Frontend (React)

- `src/components/DeviceSelector.tsx` gains a new "Healthcheck" button, enabled only when an Android device is selected.
- On click, the frontend invokes the Tauri command `check_device_health(device_id)`.
- The result drives UI:
  - Empty report (nothing residual) → green toast "Device clean", no modal.
  - Non-empty report → modal listing what was found, with a "Kill processes" button and a "Cancel" button.
- On "Kill processes" click, the frontend invokes `kill_maestro_processes(device_id, report)` passing back the exact report it received. The button is disabled while the call is in flight.
- The kill result is shown as a summary in the modal (per-step success/skip/error), with an "OK" close button.

### Backend (Rust, Tauri)

- New module `src-tauri/src/maestro_health.rs`, isolated from existing code.
- Exposes two Tauri commands:
  - `check_device_health(device_id: String) -> Result<HealthReport, HealthError>` — read-only.
  - `kill_maestro_processes(device_id: String, report: HealthReport) -> Result<KillReport, HealthError>` — destructive but bounded by `report`.
- All `adb` invocations use `-s <device_id>` to scope to the explicit device.

### Safety invariants

These are non-negotiable and must be enforced in code:

1. **Package whitelist:** the only package eligible for `am force-stop` is `dev.mobile.maestro`. Any other value passed in the report is rejected before invoking `adb`.
2. **Port whitelist:** the only port eligible for `forward --remove` is `7001`. Other ports are skipped with a logged note.
3. **Orphan process whitelist:** orphan PIDs are killed only if their process name matches `maestro` or `instrument` substrings AND the PID was present in the original `HealthReport`.
4. **PID re-verification:** before sending `kill <pid>` for an orphan, re-check `ps -p <pid>` to ensure the name still matches the whitelist (anti PID-recycling race).
5. **No `pm clear`:** v1 never wipes driver app data. Only `am force-stop`.
6. **Fail closed:** if `adb` is unavailable or the device is offline, return an error. Never fall back to a destructive default.

## Detection (`check_device_health`)

Three independent, sequential checks. Sequential is intentional: overhead is negligible and debuggability is higher.

### Check 1 — driver running

```
adb -s <device_id> shell pidof dev.mobile.maestro
```

Non-empty stdout → parse the PID into `driver_running: Some(pid)`. Empty or non-zero exit → `None`.

### Check 2 — port forwarding

```
adb -s <device_id> forward --list
```

Parse each line. If a line associates `<device_id>` with a `tcp:7001` mapping, store it as `port_forwarded: Some("tcp:7001 -> tcp:7001")` (capturing the exact mapping for the kill phase).

### Check 3 — orphan instrumentation/maestro processes

```
adb -s <device_id> shell ps -A -o PID,NAME
```

Parse line-by-line in Rust (no shell `grep`, to avoid quoting issues). Match strictly against names containing `maestro` or `instrument`. Exclude the driver PID already captured in Check 1.

### Returned shape

```rust
struct HealthReport {
    device_id: String,
    driver_running: Option<u32>,
    port_forwarded: Option<String>,
    orphan_processes: Vec<ProcessInfo>, // [{ pid, name }]
    adb_available: bool,
}

struct ProcessInfo {
    pid: u32,
    name: String,
}
```

The frontend treats the report as "zombie present" if any of `driver_running`, `port_forwarded`, or `orphan_processes` is non-empty.

### What detection does NOT do

- Never pings `tcp:7001` or speaks to the driver.
- Never inspects unrelated packages.
- Never modifies device state.

## Kill (`kill_maestro_processes`)

Operates strictly on the `HealthReport` passed in by the frontend. No re-scan inside the kill command (a re-scan could diverge from what the user just confirmed).

### Step 1 — driver

If `report.driver_running.is_some()`:

```
adb -s <device_id> shell am force-stop dev.mobile.maestro
```

The package name is hardcoded, not interpolated from the report.

### Step 2 — port forward

If `report.port_forwarded.is_some()` AND the captured mapping references `tcp:7001`:

```
adb -s <device_id> forward --remove tcp:7001
```

Other ports are skipped and noted in `KillReport.errors` as informational.

### Step 3 — orphans

For each `ProcessInfo` in `report.orphan_processes`:

1. Re-verify: `adb -s <device_id> shell ps -p <pid> -o NAME`.
2. If the returned name still matches the whitelist (`maestro` or `instrument` substring) AND matches the original `name`, send `adb -s <device_id> shell kill <pid>`.
3. Otherwise, push to `orphans_skipped` with the reason ("name changed", "not found", etc.).

### Returned shape

```rust
struct KillReport {
    driver_killed: bool,
    port_unforwarded: bool,
    orphans_killed: Vec<u32>,
    orphans_skipped: Vec<(u32, String)>, // (pid, reason)
    errors: Vec<String>,
}
```

## Error handling

Errors are surfaced explicitly to the frontend. Each maps to a clear user message:

| Condition                                  | UI message                                                       |
| ------------------------------------------ | ---------------------------------------------------------------- |
| `adb` not in PATH                          | "Android Debug Bridge introuvable. Vérifie ton installation."    |
| Device offline / not in `adb devices`      | "Device <id> non connecté."                                      |
| `adb` exits non-zero on a check            | "Healthcheck failed: <stderr>"                                   |
| Partial kill (some steps OK, some failed)  | Mixed modal listing per-step success and per-step error          |
| Whitelist violation (should not happen)    | Backend error logged, frontend shows "Internal error"            |

No silent fallbacks. No retries on destructive operations.

## Testing

### Rust unit tests

- Parser for `adb forward --list`: empty, multiple devices, non-7001 ports, malformed lines.
- Parser for `ps -A -o PID,NAME`: process names with spaces, PID 0, truncated output.
- Whitelist enforcement: rejecting `com.google.android.gm` even when present in a forged report.
- PID re-verification: simulated PID recycle → orphan is skipped.

### Rust integration tests (mocked `adb`)

- `adb` not on PATH → explicit error, no panic.
- Device disappears between check and kill → explicit error propagated.
- `adb` returns non-zero → propagated as error, never silently coerced to `false`.

### Frontend tests (Vitest if present, otherwise manual)

- Empty `HealthReport` → no modal, only the green toast.
- "Kill" button is disabled during the in-flight Tauri call (no double-click).
- Tauri command rejection → error toast.

### Out of scope for v1 testing

- Multiple devices connected simultaneously (UI already scopes to one).
- iOS.
- Automatic recovery on partial failure (user re-clicks).

## File-level summary of changes

- `src-tauri/src/maestro_health.rs` — new module, isolated.
- `src-tauri/src/lib.rs` (or wherever Tauri commands are registered) — register the two new commands.
- `src-tauri/Cargo.toml` — only if a new dep is needed (none anticipated; `std::process::Command` is sufficient).
- `src/components/DeviceSelector.tsx` — add the Healthcheck button + modal trigger.
- `src/components/HealthcheckModal.tsx` — new component for the result + kill flow.
- `src/lib/tauri.ts` (or equivalent) — typed wrappers for the two new commands.

No changes expected in: stores, existing device flows, settings.
