//! Foreground app detection + PID/UID resolution via ADB.

use crate::device::adb;
use crate::error::{AppError, AppResult};
use crate::metrics::parsers;

#[derive(Debug, Clone)]
pub struct Target {
    pub package: String,
    pub pid: u32,
    pub uid: u32,
}

pub fn current_foreground(serial: &str) -> AppResult<Option<String>> {
    let out = adb::exec_shell(serial, "dumpsys window")?;
    Ok(parsers::parse_foreground_package(&out))
}

pub fn resolve_pid(serial: &str, package: &str) -> AppResult<Option<u32>> {
    let cmd = format!("pidof {package}");
    let out = adb::exec_shell(serial, &cmd)?;
    Ok(parsers::parse_pidof(&out))
}

pub fn resolve_uid(serial: &str, package: &str) -> AppResult<Option<u32>> {
    let cmd = format!("dumpsys package {package}");
    let out = adb::exec_shell(serial, &cmd)?;
    Ok(parsers::parse_package_uid(&out))
}

/// Detect foreground, then resolve its PID + UID. Returns `None` if no
/// foreground app could be identified or if the target already died.
pub fn resolve_target(serial: &str) -> AppResult<Option<Target>> {
    let pkg = match current_foreground(serial)? {
        Some(p) => p,
        None => return Ok(None),
    };
    let pid = match resolve_pid(serial, &pkg)? {
        Some(p) => p,
        None => return Ok(None),
    };
    let uid = match resolve_uid(serial, &pkg)? {
        Some(u) => u,
        None => return Err(AppError::MetricsFailed(format!("could not resolve UID for {pkg}"))),
    };
    Ok(Some(Target { package: pkg, pid, uid }))
}
