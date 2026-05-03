//! Foreground app detection + PID/UID resolution via ADB.

use crate::device::adb;
use crate::error::AppResult;
use crate::metrics::parsers;

#[derive(Debug, Clone)]
pub struct Target {
    pub package: String,
    pub pid: u32,
    pub uid: Option<u32>,
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

/// Kernel-level fallback: ask the kernel what UID owns /proc/<pid>. Bulletproof
/// across Android versions since it doesn't depend on dumpsys output format.
pub fn resolve_uid_from_proc(serial: &str, pid: u32) -> AppResult<Option<u32>> {
    let cmd = format!("stat -c %u /proc/{pid}");
    let out = adb::exec_shell(serial, &cmd)?;
    Ok(out
        .trim()
        .split_whitespace()
        .next()
        .and_then(|s| s.parse().ok()))
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
    let uid = match resolve_uid(serial, &pkg) {
        Ok(Some(u)) => {
            tracing::info!(package = %pkg, uid = u, "UID resolved via dumpsys package");
            Some(u)
        }
        _ => match resolve_uid_from_proc(serial, pid) {
            Ok(Some(u)) => {
                tracing::info!(package = %pkg, pid, uid = u, "UID resolved via /proc stat fallback");
                Some(u)
            }
            _ => {
                tracing::warn!(package = %pkg, pid, "could not resolve UID via any method — net metrics disabled for this target");
                None
            }
        },
    };
    Ok(Some(Target {
        package: pkg,
        pid,
        uid,
    }))
}
