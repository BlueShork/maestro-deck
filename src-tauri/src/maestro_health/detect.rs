//! Read-only detection of Maestro residue on a device.

use crate::error::AppResult;
use super::HealthReport;

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

pub fn check_device_health(_device_id: &str) -> AppResult<HealthReport> {
    unimplemented!("filled in by Task 2-5")
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
}
