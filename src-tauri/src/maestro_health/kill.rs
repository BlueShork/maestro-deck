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
        let result = force_stop_driver("abc123", &report);
        assert_eq!(result.ok(), Some(false));
    }

    #[test]
    fn maestro_driver_package_is_hardcoded() {
        assert_eq!(MAESTRO_DRIVER_PACKAGE, "dev.mobile.maestro");
        let _ = ProcessInfo { pid: 1, name: "x".into() };
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
}
