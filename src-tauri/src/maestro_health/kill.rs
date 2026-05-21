// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Bounded kill operations driven by a HealthReport.

use std::process::Command;

use crate::device::adb::adb_bin;
use crate::error::{AppError, AppResult};
use crate::maestro_health::detect;
use crate::process_ext::CommandExtNoWindow;

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
        .no_window()
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
        .no_window()
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

/// Given the stdout of `adb shell ps -p <pid> -o PID,NAME`, verify that
/// `pid` is still mapped to `expected_name` AND that the name still
/// matches the orphan whitelist. Both conditions must hold.
fn reverify_pid(ps_out: &str, pid: u32, expected_name: &str) -> bool {
    for (idx, line) in ps_out.lines().enumerate() {
        if idx == 0 && line.trim_start().starts_with("PID") {
            continue;
        }
        let mut parts = line.split_whitespace();
        let pid_tok = match parts.next() {
            Some(t) => t,
            None => continue,
        };
        let name = match parts.next() {
            Some(n) => n,
            None => continue,
        };
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

fn fetch_pid_name(device_id: &str, pid: u32) -> AppResult<String> {
    let bin = adb_bin();
    let output = Command::new(&bin)
        .no_window()
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
        .no_window()
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

pub fn kill_maestro_processes(device_id: &str, report: HealthReport) -> AppResult<KillReport> {
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
                out.errors
                    .push(format!("ps -p {} failed: {} — skipping", orphan.pid, e));
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

/// Best-effort recovery: force-stop the driver and remove the standard
/// port forward. Errors are logged but not returned — callers (the
/// pre-flight wrapper) continue regardless because `maestro` will surface
/// its own error if the device is genuinely unusable.
pub fn recover_driver(device_id: &str) {
    let bin = adb_bin();

    // 1. force-stop the driver app. Hardcoded package name; never read
    //    from external input.
    match Command::new(&bin)
        .no_window()
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
        .no_window()
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
        let result = force_stop_driver("abc123", &report);
        assert_eq!(result.ok(), Some(false));
    }

    #[test]
    fn maestro_driver_package_is_hardcoded() {
        assert_eq!(MAESTRO_DRIVER_PACKAGE, "dev.mobile.maestro");
        let _ = ProcessInfo {
            pid: 1,
            name: "x".into(),
        };
    }

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

    #[test]
    fn pid_reverify_accepts_matching_name() {
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
        let ps_out = "\
PID NAME
12345 com.unrelated.app
";
        assert!(!reverify_pid(ps_out, 12345, "com.unrelated.app"));
    }
}
