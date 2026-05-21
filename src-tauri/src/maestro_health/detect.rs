// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Read-only detection of Maestro residue on a device.

use super::HealthReport;
use super::ProcessInfo;
use crate::device::adb::adb_bin;
use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;
use std::net::{SocketAddr, TcpStream};
use std::process::Command;
use std::time::Duration;

/// Runs `adb -s <device_id> <args...>` and returns stdout. Distinguishes
/// "adb not on PATH" from generic adb failures so the UI can show the
/// right message.
fn run_adb_for_device(device_id: &str, args: &[&str]) -> AppResult<String> {
    let bin = adb_bin();
    let mut full_args: Vec<&str> = vec!["-s", device_id];
    full_args.extend_from_slice(args);
    let output = Command::new(&bin)
        .no_window()
        .args(&full_args)
        .output()
        .map_err(|e| {
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

/// Returns true if the process name is a Maestro residue candidate.
/// Strict whitelist: substring match against known markers.
fn is_orphan_candidate(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("maestro") || lower.contains("instrument") || lower.contains(".am")
    // covers `com.android.commands.am`
}

/// Public mirror of the orphan whitelist for the kill module.
/// Kept distinct from the private predicate so future changes to
/// detection don't accidentally widen the kill whitelist.
pub fn is_orphan_candidate_public(name: &str) -> bool {
    is_orphan_candidate(name)
}

/// Parse `adb shell ps -A -o PID,NAME` output. Skips the header line.
/// Returns process entries that match the orphan whitelist, excluding
/// `driver_pid` (which is reported separately as `driver_running`).
fn parse_ps_orphans(stdout: &str, driver_pid: Option<u32>) -> Vec<ProcessInfo> {
    let mut out = Vec::new();
    for (idx, line) in stdout.lines().enumerate() {
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
        .no_window()
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
        parse_forward_list(&String::from_utf8_lossy(&forward_out.stdout), device_id)
    } else {
        None
    };

    // Check 3 — orphan processes
    let ps_out = run_adb_for_device(device_id, &["shell", "ps", "-A", "-o", "PID,NAME"])?;
    let orphan_processes = parse_ps_orphans(&ps_out, driver_running);

    Ok(HealthReport {
        device_id: device_id.to_string(),
        driver_running,
        port_forwarded,
        orphan_processes,
        adb_available: true,
    })
}

/// Parse `adb forward --list` output. Lines look like:
///     <serial> tcp:<local> tcp:<remote>
/// Returns the full mapping (e.g. "tcp:7001 tcp:7001") iff a line for
/// `device_id` references the Maestro driver port.
fn parse_forward_list(stdout: &str, device_id: &str) -> Option<String> {
    let target_port = format!("tcp:{}", super::MAESTRO_DRIVER_PORT);
    for line in stdout.lines() {
        let mut parts = line.split_whitespace();
        let serial = match parts.next() {
            Some(s) => s,
            None => continue,
        };
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
                ProcessInfo {
                    pid: 5678,
                    name: "com.android.commands.am".into()
                },
                ProcessInfo {
                    pid: 3456,
                    name: "instrumentation.helper".into()
                },
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
            vec![ProcessInfo {
                pid: 1234,
                name: "dev.mobile.maestro".into()
            }]
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
}
