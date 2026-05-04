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
