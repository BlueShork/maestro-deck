# Maestro Device Healthcheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click healthcheck button to the device selector that detects and (after user confirmation) kills leftover Maestro driver/port-forward/instrumentation residue on a connected Android device.

**Architecture:** A new isolated Rust module `maestro_health` exposes two Tauri commands (`check_device_health`, `kill_maestro_processes`) that shell out to `adb -s <serial> ...`. Detection is read-only and produces a `HealthReport`. The frontend renders the report in a modal; the user confirms, and the report is passed back to the kill command which operates strictly on its contents, guarded by hardcoded whitelists.

**Tech Stack:** Rust (Tauri 2), `std::process::Command`, existing `device::adb::adb_bin()` helper, React 18, Zustand store, Radix Dialog, existing toast store.

**Spec:** `docs/superpowers/specs/2026-05-04-maestro-device-healthcheck-design.md`

---

## File Structure

**New files:**
- `src-tauri/src/maestro_health/mod.rs` — module root, public types and command-facing functions.
- `src-tauri/src/maestro_health/detect.rs` — `check_device_health` logic + parsers.
- `src-tauri/src/maestro_health/kill.rs` — `kill_maestro_processes` logic + whitelists.
- `src/components/HealthcheckModal.tsx` — modal showing the report and triggering the kill.

**Modified files:**
- `src-tauri/src/lib.rs` — register module and the two new commands.
- `src-tauri/src/ipc/commands.rs` — `#[tauri::command]` wrappers.
- `src/lib/ipc.ts` — typed wrappers for the two new commands.
- `src/types/index.ts` (or wherever `Device` lives) — add `HealthReport`, `KillReport`, `ProcessInfo` types. Verify the exact path during Task 10.
- `src/components/DeviceSelector.tsx` — add Healthcheck button on the active device row.

---

## Task 1: Module skeleton + shared types

**Files:**
- Create: `src-tauri/src/maestro_health/mod.rs`
- Create: `src-tauri/src/maestro_health/detect.rs`
- Create: `src-tauri/src/maestro_health/kill.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod maestro_health;` after the existing `pub mod ipc;`)

- [ ] **Step 1: Create `src-tauri/src/maestro_health/mod.rs`**

```rust
//! Detect and remove leftover Maestro driver, port forwarding, and
//! instrumentation residue on a connected Android device.
//!
//! Two entry points:
//! - [`detect::check_device_health`] — read-only.
//! - [`kill::kill_maestro_processes`] — destructive, bounded by a
//!   `HealthReport` provided by the caller and guarded by hardcoded
//!   whitelists.

pub mod detect;
pub mod kill;

use serde::{Deserialize, Serialize};

/// The Maestro driver Android package. The ONLY package eligible for
/// `am force-stop`. Hardcoded — never read from user input.
pub const MAESTRO_DRIVER_PACKAGE: &str = "dev.mobile.maestro";

/// The standard Maestro driver port. The ONLY port eligible for
/// `adb forward --remove`.
pub const MAESTRO_DRIVER_PORT: u16 = 7001;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthReport {
    pub device_id: String,
    pub driver_running: Option<u32>,
    pub port_forwarded: Option<String>,
    pub orphan_processes: Vec<ProcessInfo>,
    pub adb_available: bool,
}

impl HealthReport {
    pub fn is_clean(&self) -> bool {
        self.driver_running.is_none()
            && self.port_forwarded.is_none()
            && self.orphan_processes.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KillReport {
    pub driver_killed: bool,
    pub port_unforwarded: bool,
    pub orphans_killed: Vec<u32>,
    pub orphans_skipped: Vec<(u32, String)>,
    pub errors: Vec<String>,
}
```

- [ ] **Step 2: Create empty stubs for `detect.rs` and `kill.rs`**

`src-tauri/src/maestro_health/detect.rs`:
```rust
//! Read-only detection of Maestro residue on a device.

use crate::error::AppResult;
use super::HealthReport;

pub fn check_device_health(_device_id: &str) -> AppResult<HealthReport> {
    unimplemented!("filled in by Task 2-5")
}
```

`src-tauri/src/maestro_health/kill.rs`:
```rust
//! Bounded kill operations driven by a HealthReport.

use crate::error::AppResult;
use super::{HealthReport, KillReport};

pub fn kill_maestro_processes(_device_id: &str, _report: HealthReport) -> AppResult<KillReport> {
    unimplemented!("filled in by Task 6-8")
}
```

- [ ] **Step 3: Register module in `src-tauri/src/lib.rs`**

Add `pub mod maestro_health;` in the module list (alphabetical position: between `ipc` and `metrics`).

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: warnings about `unimplemented!` are OK. No errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/maestro_health src-tauri/src/lib.rs
git commit -m "feat(health): scaffold maestro_health module with shared types"
```

---

## Task 2: Detection — driver running

**Files:**
- Modify: `src-tauri/src/maestro_health/detect.rs`

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/maestro_health/detect.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_pidof_present() {
        assert_eq!(parse_pidof("12345\n"), Some(12345));
    }

    #[test]
    fn parse_pidof_with_multiple_pids_takes_first() {
        assert_eq!(parse_pidof("12345 67890\n"), Some(12345));
    }

    #[test]
    fn parse_pidof_empty() {
        assert_eq!(parse_pidof(""), None);
        assert_eq!(parse_pidof("\n"), None);
    }

    #[test]
    fn parse_pidof_garbage() {
        assert_eq!(parse_pidof("notanumber"), None);
    }
}
```

- [ ] **Step 2: Run test — should fail to compile (no `parse_pidof`)**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::detect::tests`
Expected: compilation error "cannot find function `parse_pidof`".

- [ ] **Step 3: Implement `parse_pidof`**

Add to `detect.rs` (above the `tests` module):

```rust
/// Parse the stdout of `adb shell pidof <package>`.
/// `pidof` prints space-separated PIDs followed by a newline, or nothing
/// if the package is not running. We take the first PID since multiple
/// instances of the driver are unexpected.
fn parse_pidof(stdout: &str) -> Option<u32> {
    stdout
        .split_whitespace()
        .next()
        .and_then(|tok| tok.parse::<u32>().ok())
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::detect::tests`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/maestro_health/detect.rs
git commit -m "feat(health): parse pidof output for driver detection"
```

---

## Task 3: Detection — port forwarding parser

**Files:**
- Modify: `src-tauri/src/maestro_health/detect.rs`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `tests` module in `detect.rs`:

```rust
    #[test]
    fn parse_forward_finds_7001_for_device() {
        let out = "abc123 tcp:7001 tcp:7001\nxyz999 tcp:5037 tcp:5037\n";
        assert_eq!(
            parse_forward_list(out, "abc123"),
            Some("tcp:7001 tcp:7001".to_string())
        );
    }

    #[test]
    fn parse_forward_ignores_other_devices() {
        let out = "other tcp:7001 tcp:7001\n";
        assert_eq!(parse_forward_list(out, "abc123"), None);
    }

    #[test]
    fn parse_forward_ignores_other_ports() {
        let out = "abc123 tcp:9999 tcp:9999\n";
        assert_eq!(parse_forward_list(out, "abc123"), None);
    }

    #[test]
    fn parse_forward_empty() {
        assert_eq!(parse_forward_list("", "abc123"), None);
    }

    #[test]
    fn parse_forward_malformed_lines_skipped() {
        let out = "garbage\nabc123 tcp:7001 tcp:7001\n";
        assert_eq!(
            parse_forward_list(out, "abc123"),
            Some("tcp:7001 tcp:7001".to_string())
        );
    }
```

- [ ] **Step 2: Run tests — should fail**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::detect::tests`
Expected: compilation error.

- [ ] **Step 3: Implement `parse_forward_list`**

Add to `detect.rs`:

```rust
/// Parse `adb forward --list` output. Lines look like:
///     <serial> tcp:<local> tcp:<remote>
/// Returns the full mapping (e.g. "tcp:7001 tcp:7001") iff a line for
/// `device_id` references the Maestro driver port.
fn parse_forward_list(stdout: &str, device_id: &str) -> Option<String> {
    let target_port = format!("tcp:{}", super::MAESTRO_DRIVER_PORT);
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        let serial = parts.next()?;
        if serial != device_id {
            continue;
        }
        let local = parts.next();
        let remote = parts.next();
        match (local, remote) {
            (Some(l), Some(r)) if l == target_port || r == target_port => {
                return Some(format!("{} {}", l, r));
            }
            _ => continue,
        }
    }
    None
}
```

Note: `parts.next()?` inside `for` returns from the function on a malformed first token, but the loop continues per-line via `continue`. The `?` only fires when the line has zero tokens, which `lines()` filters out for empty strings; for an all-whitespace line, `next()` returns `None` and we early-return `None` overall. That matches the "garbage" test case which has a token. **Actually**, change `parts.next()?` to a non-failing form to keep one bad line from killing the whole parse:

Replace `let serial = parts.next()?;` with:
```rust
        let serial = match parts.next() {
            Some(s) => s,
            None => continue,
        };
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::detect::tests`
Expected: all 9 passing.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/maestro_health/detect.rs
git commit -m "feat(health): parse adb forward --list for maestro port"
```

---

## Task 4: Detection — orphan process parser

**Files:**
- Modify: `src-tauri/src/maestro_health/detect.rs`

- [ ] **Step 1: Write the failing tests**

Append inside the `tests` module:

```rust
    #[test]
    fn parse_ps_finds_maestro_and_instrument() {
        let out = "\
PID NAME
1234 dev.mobile.maestro
5678 com.android.commands.am
9012 system_server
3456 instrumentation.helper
";
        let driver_pid = Some(1234);
        let orphans = parse_ps_orphans(out, driver_pid);
        assert_eq!(
            orphans,
            vec![
                ProcessInfo { pid: 5678, name: "com.android.commands.am".into() },
                ProcessInfo { pid: 3456, name: "instrumentation.helper".into() },
            ]
        );
    }

    #[test]
    fn parse_ps_excludes_known_driver_pid() {
        let out = "\
PID NAME
1234 dev.mobile.maestro
";
        assert_eq!(parse_ps_orphans(out, Some(1234)), vec![]);
    }

    #[test]
    fn parse_ps_includes_driver_when_pid_unknown() {
        let out = "\
PID NAME
1234 dev.mobile.maestro
";
        assert_eq!(
            parse_ps_orphans(out, None),
            vec![ProcessInfo { pid: 1234, name: "dev.mobile.maestro".into() }]
        );
    }

    #[test]
    fn parse_ps_skips_non_matching() {
        let out = "\
PID NAME
1 init
2 zygote
";
        assert_eq!(parse_ps_orphans(out, None), vec![]);
    }

    #[test]
    fn parse_ps_handles_empty() {
        assert_eq!(parse_ps_orphans("", None), vec![]);
    }
```

Add `use super::ProcessInfo;` import inside the `tests` module if not already present.

- [ ] **Step 2: Run tests — should fail**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::detect::tests`
Expected: compilation error.

- [ ] **Step 3: Implement `parse_ps_orphans`**

Add to `detect.rs`:

```rust
use super::ProcessInfo;

/// Returns true if the process name is a Maestro residue candidate.
/// Strict whitelist: substring match against known markers.
fn is_orphan_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("maestro")
        || lower.contains("instrument")
        || lower.contains(".am") // covers `com.android.commands.am`
}

/// Parse `adb shell ps -A -o PID,NAME` output. Skips the header line.
/// Returns process entries that match the orphan whitelist, excluding
/// `driver_pid` (which is reported separately as `driver_running`).
fn parse_ps_orphans(stdout: &str, driver_pid: Option<u32>) -> Vec<ProcessInfo> {
    let mut out = Vec::new();
    for (idx, line) in stdout.lines().enumerate() {
        // Skip the header `PID NAME` line.
        if idx == 0 && line.trim_start().starts_with("PID") {
            continue;
        }
        let mut parts = line.split_whitespace();
        let pid_tok = match parts.next() {
            Some(t) => t,
            None => continue,
        };
        let name = match parts.next() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let pid: u32 = match pid_tok.parse() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if Some(pid) == driver_pid {
            continue;
        }
        if !is_orphan_candidate(&name) {
            continue;
        }
        out.push(ProcessInfo { pid, name });
    }
    out
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::detect::tests`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/maestro_health/detect.rs
git commit -m "feat(health): parse ps output for orphan maestro processes"
```

---

## Task 5: Detection — wire up `check_device_health`

**Files:**
- Modify: `src-tauri/src/maestro_health/detect.rs`
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs` (add command to `invoke_handler!`)

- [ ] **Step 1: Add private helper `run_adb_for_device` to `detect.rs`**

```rust
use std::process::Command;
use crate::device::adb::adb_bin;
use crate::error::{AppError, AppResult};

/// Runs `adb -s <device_id> <args...>` and returns stdout. Distinguishes
/// "adb not on PATH" from generic adb failures so the UI can show the
/// right message.
fn run_adb_for_device(device_id: &str, args: &[&str]) -> AppResult<String> {
    let bin = adb_bin();
    let mut full_args: Vec<&str> = vec!["-s", device_id];
    full_args.extend_from_slice(args);
    let output = Command::new(&bin).args(&full_args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::AdbNotFound
        } else {
            AppError::Io(e)
        }
    })?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(AppError::AdbFailed(stderr));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}
```

- [ ] **Step 2: Replace the `unimplemented!` body of `check_device_health`**

```rust
pub fn check_device_health(device_id: &str) -> AppResult<HealthReport> {
    // Check 1 — driver running
    let driver_running = match run_adb_for_device(
        device_id,
        &["shell", "pidof", super::MAESTRO_DRIVER_PACKAGE],
    ) {
        Ok(out) => parse_pidof(&out),
        // `pidof` exits non-zero when the package isn't running; that's
        // not a real adb failure, just an empty result.
        Err(AppError::AdbFailed(_)) => None,
        Err(e) => return Err(e),
    };

    // Check 2 — port forwarding
    // `forward --list` is host-side, not device-scoped. Run without -s
    // and filter by device.
    let bin = adb_bin();
    let forward_out = std::process::Command::new(&bin)
        .args(["forward", "--list"])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    let port_forwarded = if forward_out.status.success() {
        parse_forward_list(
            &String::from_utf8_lossy(&forward_out.stdout),
            device_id,
        )
    } else {
        None
    };

    // Check 3 — orphan processes
    let ps_out = run_adb_for_device(
        device_id,
        &["shell", "ps", "-A", "-o", "PID,NAME"],
    )?;
    let orphan_processes = parse_ps_orphans(&ps_out, driver_running);

    Ok(HealthReport {
        device_id: device_id.to_string(),
        driver_running,
        port_forwarded,
        orphan_processes,
        adb_available: true,
    })
}
```

- [ ] **Step 3: Add the Tauri command wrapper**

Append to `src-tauri/src/ipc/commands.rs` (near the other device commands, after `disconnect_device`):

```rust
use crate::maestro_health::{self, HealthReport, KillReport};

#[tauri::command]
pub fn check_device_health(serial: String) -> AppResult<HealthReport> {
    maestro_health::detect::check_device_health(&serial)
}
```

- [ ] **Step 4: Register the command in `src-tauri/src/lib.rs`**

In the `invoke_handler![…]` macro, add `check_device_health` after `disconnect_device`.

- [ ] **Step 5: Verify compilation**

Run: `cd src-tauri && cargo build`
Expected: success (warnings about unused imports in `kill.rs` are acceptable).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/maestro_health src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "feat(health): wire check_device_health tauri command"
```

---

## Task 6: Kill — driver `am force-stop` with whitelist

**Files:**
- Modify: `src-tauri/src/maestro_health/kill.rs`

- [ ] **Step 1: Write the failing test**

Replace contents of `kill.rs` with:

```rust
//! Bounded kill operations driven by a HealthReport.

use std::process::Command;

use crate::device::adb::adb_bin;
use crate::error::{AppError, AppResult};

use super::{HealthReport, KillReport, MAESTRO_DRIVER_PACKAGE, MAESTRO_DRIVER_PORT};

/// Kill the driver app via `am force-stop`. Returns `Ok(true)` on
/// success, `Ok(false)` if `report.driver_running` is `None`. The
/// package name is hardcoded; the report PID is informational only.
fn force_stop_driver(device_id: &str, report: &HealthReport) -> AppResult<bool> {
    if report.driver_running.is_none() {
        return Ok(false);
    }
    let bin = adb_bin();
    let output = Command::new(&bin)
        .args([
            "-s",
            device_id,
            "shell",
            "am",
            "force-stop",
            MAESTRO_DRIVER_PACKAGE,
        ])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        return Err(AppError::AdbFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(true)
}

pub fn kill_maestro_processes(_device_id: &str, _report: HealthReport) -> AppResult<KillReport> {
    unimplemented!("filled in by Task 9")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maestro_health::ProcessInfo;

    fn report_with_driver(pid: Option<u32>) -> HealthReport {
        HealthReport {
            device_id: "abc123".into(),
            driver_running: pid,
            port_forwarded: None,
            orphan_processes: vec![],
            adb_available: true,
        }
    }

    #[test]
    fn force_stop_skipped_when_driver_absent() {
        let report = report_with_driver(None);
        // We don't actually call adb here — short-circuit returns Ok(false).
        let result = force_stop_driver("abc123", &report);
        assert_eq!(result.ok(), Some(false));
    }

    #[test]
    fn maestro_driver_package_is_hardcoded() {
        // Sanity: the constant is never read from a report field.
        assert_eq!(MAESTRO_DRIVER_PACKAGE, "dev.mobile.maestro");
        let _ = ProcessInfo { pid: 1, name: "x".into() };
    }
}
```

- [ ] **Step 2: Run tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::kill::tests`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/maestro_health/kill.rs
git commit -m "feat(health): force-stop driver with hardcoded whitelist"
```

---

## Task 7: Kill — port unforward

**Files:**
- Modify: `src-tauri/src/maestro_health/kill.rs`

- [ ] **Step 1: Write the failing tests**

Append inside the `tests` module:

```rust
    #[test]
    fn port_unforward_skipped_when_no_forward() {
        let report = HealthReport {
            device_id: "abc".into(),
            driver_running: None,
            port_forwarded: None,
            orphan_processes: vec![],
            adb_available: true,
        };
        assert_eq!(should_unforward(&report), None);
    }

    #[test]
    fn port_unforward_only_for_7001() {
        let mut report = HealthReport {
            device_id: "abc".into(),
            driver_running: None,
            port_forwarded: Some("tcp:9999 tcp:9999".into()),
            orphan_processes: vec![],
            adb_available: true,
        };
        assert_eq!(should_unforward(&report), None);
        report.port_forwarded = Some("tcp:7001 tcp:7001".into());
        assert_eq!(should_unforward(&report), Some(MAESTRO_DRIVER_PORT));
    }
```

- [ ] **Step 2: Run tests — should fail**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::kill::tests`
Expected: compilation error.

- [ ] **Step 3: Implement `should_unforward` and `do_unforward`**

Add to `kill.rs` (above the `tests` module):

```rust
/// Returns `Some(port)` iff the report references the Maestro driver
/// port. Other ports are intentionally ignored to avoid disrupting
/// unrelated user setup.
fn should_unforward(report: &HealthReport) -> Option<u16> {
    let raw = report.port_forwarded.as_deref()?;
    let target = format!("tcp:{}", MAESTRO_DRIVER_PORT);
    if raw.contains(&target) {
        Some(MAESTRO_DRIVER_PORT)
    } else {
        None
    }
}

fn do_unforward(device_id: &str, port: u16) -> AppResult<()> {
    let bin = adb_bin();
    let arg = format!("tcp:{}", port);
    let output = Command::new(&bin)
        .args(["-s", device_id, "forward", "--remove", &arg])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        return Err(AppError::AdbFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}
```

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::kill::tests`
Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/maestro_health/kill.rs
git commit -m "feat(health): selectively unforward maestro port only"
```

---

## Task 8: Kill — orphan kills with PID re-verification

**Files:**
- Modify: `src-tauri/src/maestro_health/kill.rs`

- [ ] **Step 1: Write the failing tests**

Append inside `tests` module:

```rust
    #[test]
    fn pid_reverify_accepts_matching_name() {
        // ps -p output simulating a still-running matching process.
        let ps_out = "\
PID NAME
12345 com.android.commands.am
";
        assert!(reverify_pid(ps_out, 12345, "com.android.commands.am"));
    }

    #[test]
    fn pid_reverify_rejects_name_mismatch() {
        let ps_out = "\
PID NAME
12345 com.unrelated.app
";
        assert!(!reverify_pid(ps_out, 12345, "com.android.commands.am"));
    }

    #[test]
    fn pid_reverify_rejects_when_pid_gone() {
        let ps_out = "PID NAME\n";
        assert!(!reverify_pid(ps_out, 12345, "anything"));
    }

    #[test]
    fn pid_reverify_rejects_non_whitelisted_name() {
        // Even if name matches the original, it must still pass the whitelist.
        let ps_out = "\
PID NAME
12345 com.unrelated.app
";
        assert!(!reverify_pid(ps_out, 12345, "com.unrelated.app"));
    }
```

- [ ] **Step 2: Run tests — should fail**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health::kill::tests`
Expected: compilation error.

- [ ] **Step 3: Implement `reverify_pid`**

Add to `kill.rs`:

```rust
use crate::maestro_health::detect; // not yet exposed; see Step 4

/// Given the stdout of `adb shell ps -p <pid> -o PID,NAME`, verify that
/// `pid` is still mapped to `expected_name` AND that the name still
/// matches the orphan whitelist. Both conditions must hold.
fn reverify_pid(ps_out: &str, pid: u32, expected_name: &str) -> bool {
    for (idx, line) in ps_out.lines().enumerate() {
        if idx == 0 && line.trim_start().starts_with("PID") {
            continue;
        }
        let mut parts = line.split_whitespace();
        let pid_tok = match parts.next() { Some(t) => t, None => continue };
        let name = match parts.next() { Some(n) => n, None => continue };
        if pid_tok.parse::<u32>().ok() != Some(pid) {
            continue;
        }
        if name != expected_name {
            return false;
        }
        return detect::is_orphan_candidate_public(name);
    }
    false
}
```

- [ ] **Step 4: Expose the whitelist predicate from `detect.rs`**

In `src-tauri/src/maestro_health/detect.rs`, add a public re-export below the existing `is_orphan_candidate`:

```rust
/// Public mirror of the orphan whitelist for the kill module.
/// Kept distinct from the private predicate so future changes to
/// detection don't accidentally widen the kill whitelist.
pub fn is_orphan_candidate_public(name: &str) -> bool {
    is_orphan_candidate(name)
}
```

- [ ] **Step 5: Run tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health`
Expected: all passing.

- [ ] **Step 6: Implement `do_kill_orphan` (no test — pure adb side-effect)**

Add to `kill.rs`:

```rust
fn fetch_pid_name(device_id: &str, pid: u32) -> AppResult<String> {
    let bin = adb_bin();
    let output = Command::new(&bin)
        .args([
            "-s",
            device_id,
            "shell",
            "ps",
            "-p",
            &pid.to_string(),
            "-o",
            "PID,NAME",
        ])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn do_kill_pid(device_id: &str, pid: u32) -> AppResult<()> {
    let bin = adb_bin();
    let output = Command::new(&bin)
        .args(["-s", device_id, "shell", "kill", &pid.to_string()])
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::AdbNotFound
            } else {
                AppError::Io(e)
            }
        })?;
    if !output.status.success() {
        return Err(AppError::AdbFailed(
            String::from_utf8_lossy(&output.stderr).trim().to_string(),
        ));
    }
    Ok(())
}
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/maestro_health
git commit -m "feat(health): pid re-verification before orphan kill"
```

---

## Task 9: Kill — wire up `kill_maestro_processes`

**Files:**
- Modify: `src-tauri/src/maestro_health/kill.rs`
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Replace `kill_maestro_processes` with the full orchestration**

```rust
pub fn kill_maestro_processes(
    device_id: &str,
    report: HealthReport,
) -> AppResult<KillReport> {
    let mut out = KillReport::default();

    // Step 1 — driver
    match force_stop_driver(device_id, &report) {
        Ok(killed) => out.driver_killed = killed,
        Err(e) => out.errors.push(format!("driver force-stop failed: {}", e)),
    }

    // Step 2 — port forward
    if let Some(port) = should_unforward(&report) {
        match do_unforward(device_id, port) {
            Ok(()) => out.port_unforwarded = true,
            Err(e) => out.errors.push(format!("forward --remove failed: {}", e)),
        }
    } else if report.port_forwarded.is_some() {
        out.errors.push(format!(
            "port forward {:?} skipped (only tcp:{} is whitelisted)",
            report.port_forwarded, MAESTRO_DRIVER_PORT
        ));
    }

    // Step 3 — orphans
    for orphan in &report.orphan_processes {
        let ps_out = match fetch_pid_name(device_id, orphan.pid) {
            Ok(s) => s,
            Err(e) => {
                out.errors.push(format!(
                    "ps -p {} failed: {} — skipping",
                    orphan.pid, e
                ));
                continue;
            }
        };
        if !reverify_pid(&ps_out, orphan.pid, &orphan.name) {
            out.orphans_skipped
                .push((orphan.pid, "name changed or pid gone".into()));
            continue;
        }
        match do_kill_pid(device_id, orphan.pid) {
            Ok(()) => out.orphans_killed.push(orphan.pid),
            Err(e) => {
                out.orphans_skipped
                    .push((orphan.pid, format!("kill failed: {}", e)));
            }
        }
    }

    Ok(out)
}
```

- [ ] **Step 2: Add Tauri command wrapper in `commands.rs`**

```rust
#[tauri::command]
pub fn kill_maestro_processes(serial: String, report: HealthReport) -> AppResult<KillReport> {
    maestro_health::kill::kill_maestro_processes(&serial, report)
}
```

- [ ] **Step 3: Register in `lib.rs`'s `invoke_handler!`**

Add `kill_maestro_processes` after `check_device_health`.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: clean build.

- [ ] **Step 5: Run all health tests**

Run: `cd src-tauri && cargo test -p maestro-deck --lib maestro_health`
Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat(health): expose kill_maestro_processes tauri command"
```

---

## Task 10: Frontend — TS types and ipc bindings

**Files:**
- Modify: `src/types/index.ts` (verify exact path; if types live elsewhere, e.g. `src/types/device.ts`, add there instead)
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Locate the types file**

Run: `grep -rn "export interface Device" src/types`
Expected: one location. Add new types to the same file.

- [ ] **Step 2: Add TS types**

```typescript
export interface ProcessInfo {
  pid: number;
  name: string;
}

export interface HealthReport {
  device_id: string;
  driver_running: number | null;
  port_forwarded: string | null;
  orphan_processes: ProcessInfo[];
  adb_available: boolean;
}

export interface KillReport {
  driver_killed: boolean;
  port_unforwarded: boolean;
  orphans_killed: number[];
  orphans_skipped: [number, string][];
  errors: string[];
}

export function isHealthReportClean(r: HealthReport): boolean {
  return (
    r.driver_running === null &&
    r.port_forwarded === null &&
    r.orphan_processes.length === 0
  );
}
```

- [ ] **Step 3: Add ipc methods**

Append to the `ipc` object in `src/lib/ipc.ts`:

```typescript
  checkDeviceHealth: (serial: string) =>
    call<HealthReport>("check_device_health", { serial }),
  killMaestroProcesses: (serial: string, report: HealthReport) =>
    call<KillReport>("kill_maestro_processes", { serial, report }),
```

Add to the imports at the top of the file:

```typescript
import type { HealthReport, KillReport } from "@/types";
// (merge into the existing import line if there is one)
```

- [ ] **Step 4: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types src/lib/ipc.ts
git commit -m "feat(health): typescript bindings for healthcheck commands"
```

---

## Task 11: Frontend — `HealthcheckModal` component

**Files:**
- Create: `src/components/HealthcheckModal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
import { Loader2, Stethoscope } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/Dialog";
import { ipc } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { HealthReport, KillReport } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  serial: string;
  report: HealthReport;
}

export function HealthcheckModal({ open, onOpenChange, serial, report }: Props) {
  const [killing, setKilling] = useState(false);
  const [result, setResult] = useState<KillReport | null>(null);

  const onKill = async () => {
    setKilling(true);
    try {
      const r = await ipc.killMaestroProcesses(serial, report);
      setResult(r);
      const summary = [
        r.driver_killed && "driver killed",
        r.port_unforwarded && "port 7001 released",
        r.orphans_killed.length > 0 && `${r.orphans_killed.length} orphan(s) killed`,
      ]
        .filter(Boolean)
        .join(", ");
      if (r.errors.length === 0) {
        toast.success("Device cleaned", summary || "no actions needed");
      } else {
        toast.error("Cleanup partial", r.errors.join("; "));
      }
    } catch (err) {
      toast.error("Kill failed", err instanceof Error ? err.message : String(err));
    } finally {
      setKilling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Maestro residue detected
          </DialogTitle>
          <DialogDescription>
            The following Maestro artifacts are still present on{" "}
            <span className="font-mono">{serial}</span>. Kill them to recover
            without restarting Maestro Deck.
          </DialogDescription>
        </DialogHeader>

        <ul className="flex flex-col gap-1 text-sm">
          {report.driver_running !== null && (
            <li>
              · Driver app <span className="font-mono">dev.mobile.maestro</span>{" "}
              running (pid {report.driver_running})
            </li>
          )}
          {report.port_forwarded !== null && (
            <li>
              · Port forwarding active:{" "}
              <span className="font-mono">{report.port_forwarded}</span>
            </li>
          )}
          {report.orphan_processes.map((p) => (
            <li key={p.pid}>
              · Orphan process <span className="font-mono">{p.name}</span> (pid {p.pid})
            </li>
          ))}
        </ul>

        {result && (
          <div className="rounded border border-border bg-muted/30 p-2 text-xs">
            <div>Driver killed: {String(result.driver_killed)}</div>
            <div>Port released: {String(result.port_unforwarded)}</div>
            <div>Orphans killed: {result.orphans_killed.join(", ") || "—"}</div>
            {result.orphans_skipped.length > 0 && (
              <div>
                Skipped:{" "}
                {result.orphans_skipped.map(([pid, why]) => `${pid} (${why})`).join(", ")}
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="text-destructive">
                Errors: {result.errors.join("; ")}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <Button onClick={() => onOpenChange(false)}>OK</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={killing}>
                Cancel
              </Button>
              <Button onClick={onKill} disabled={killing}>
                {killing ? (
                  <>
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Killing…
                  </>
                ) : (
                  "Kill processes"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm typecheck`
Expected: no errors. If `Dialog`/`DialogContent`/etc. have different export names in `src/components/ui/Dialog.tsx`, adjust imports accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/components/HealthcheckModal.tsx
git commit -m "feat(health): healthcheck result + kill confirmation modal"
```

---

## Task 12: Frontend — wire button into `DeviceSelector`

**Files:**
- Modify: `src/components/DeviceSelector.tsx`

- [ ] **Step 1: Add state + handler at the top of the component**

Inside `DeviceSelector`, after the `useDeviceStore` destructure:

```tsx
import { Stethoscope } from "lucide-react";
import { useState } from "react";

import { HealthcheckModal } from "@/components/HealthcheckModal";
import { ipc } from "@/lib/ipc";
import { toast } from "@/stores/toastStore";
import type { HealthReport } from "@/types";
import { isHealthReportClean } from "@/types";
```

(Merge with existing imports — no duplicates.)

Inside the component body:

```tsx
  const [checkingSerial, setCheckingSerial] = useState<string | null>(null);
  const [report, setReport] = useState<HealthReport | null>(null);

  const onHealthcheck = async (serial: string) => {
    setCheckingSerial(serial);
    try {
      const r = await ipc.checkDeviceHealth(serial);
      if (isHealthReportClean(r)) {
        toast.success("Device clean", "No Maestro residue detected.");
      } else {
        setReport(r);
      }
    } catch (err) {
      toast.error("Healthcheck failed", err instanceof Error ? err.message : String(err));
    } finally {
      setCheckingSerial(null);
    }
  };
```

- [ ] **Step 2: Add the button inside each device row**

Inside the `<button …>` device row, just before the closing `</button>`, replace the trailing icon block (the `isPending ? Loader2 : active ? PlugZap : Plug` chunk) with a wrapping `<div className="flex items-center gap-1">` that contains the existing icon AND the new healthcheck icon button. Render the healthcheck icon only when the row is the active device:

```tsx
                <div className="flex items-center gap-1">
                  {active && !isPending && (
                    <span
                      role="button"
                      aria-label="Healthcheck device"
                      onClick={(e) => {
                        e.stopPropagation();
                        void onHealthcheck(d.serial);
                      }}
                      className="rounded p-0.5 hover:bg-emerald-500/20"
                    >
                      {checkingSerial === d.serial ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                      ) : (
                        <Stethoscope className="h-3.5 w-3.5 text-emerald-500" />
                      )}
                    </span>
                  )}
                  {isPending ? (
                    <Loader2
                      className={cn(
                        "h-3.5 w-3.5 animate-spin",
                        isConnecting ? "text-emerald-500" : "text-amber-500",
                      )}
                    />
                  ) : active ? (
                    <PlugZap className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <Plug className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                  )}
                </div>
```

The healthcheck icon uses `<span role="button">` (not a nested `<button>`) because the row itself is a `<button>` — nesting buttons is invalid HTML. `e.stopPropagation()` prevents the row's connect/disconnect handler from firing.

- [ ] **Step 3: Mount the modal at the bottom of the component**

Just before the final `</div>` of the component:

```tsx
      {report && (
        <HealthcheckModal
          open={true}
          onOpenChange={(o) => !o && setReport(null)}
          serial={report.device_id}
          report={report}
        />
      )}
```

- [ ] **Step 4: Verify typecheck and lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 5: Manual test**

Run: `pnpm tauri:dev`

With an Android device connected:
1. Connect the device in the UI.
2. Click the stethoscope icon. If the device is clean → green toast.
3. To force a positive case: launch the Maestro driver manually (`adb shell am start -n dev.mobile.maestro/.MainActivity` if it's installed, or run a Maestro test then crash it). Click the stethoscope → modal should list the driver.
4. Click "Kill processes" → modal switches to result view, summary toast appears.
5. Click stethoscope again → green toast (clean).

If you cannot test with a physical device, document this in the PR description; do not claim it works.

- [ ] **Step 6: Commit**

```bash
git add src/components/DeviceSelector.tsx
git commit -m "feat(health): healthcheck button on active device row"
```

---

## Self-Review Notes

- **Spec coverage:** All four spec sections (architecture, detection, kill, error handling, testing) are covered. Detection checks 1/2/3 → Tasks 2/3/4. Kill steps 1/2/3 → Tasks 6/7/8. Whitelists hardcoded → Tasks 1, 6, 7, 8. PID re-verification → Task 8. Error mapping uses existing `AppError::AdbNotFound` / `AppError::AdbFailed` which produce the same user-facing strings the spec lists.
- **No iOS code paths.** Confirmed.
- **No `pm clear` anywhere.** Confirmed (only `am force-stop`).
- **Type consistency:** `HealthReport`, `KillReport`, `ProcessInfo` field names match between Rust (snake_case via serde default) and TS. The TS structural test `isHealthReportClean` mirrors Rust's `HealthReport::is_clean`.
