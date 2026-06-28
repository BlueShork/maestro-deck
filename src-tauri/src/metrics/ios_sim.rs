// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! iOS simulator metrics. A simulated app runs as a host macOS process, so its
//! CPU% and resident memory are readable with `ps`. Collection commands live in
//! the collector loop (mod.rs); the pure `ps` parser lives here for testing.

use std::process::Command;

use crate::error::{AppError, AppResult};

/// Parse `ps -o %cpu=,rss= -p <pid>` output → (cpu_pct, mem_mb).
/// macOS reports RSS in KiB. Returns None if the line can't be parsed (e.g. the
/// process has exited and ps printed nothing).
pub fn parse_ps_cpu_rss(s: &str) -> Option<(f32, f32)> {
    let line = s.lines().map(str::trim).find(|l| !l.is_empty())?;
    let mut cols = line.split_whitespace();
    let cpu: f32 = cols.next()?.parse().ok()?;
    let rss_kib: f32 = cols.next()?.parse().ok()?;
    Some((cpu, rss_kib / 1024.0))
}

/// Find the host PID + bundle id of the foreground app under test from
/// `simctl spawn <udid> launchctl list` output. Rows look like
/// `<pid>\t<status>\tUIKitApplication:<bundleId>[hex][rb-legacy]`.
///
/// The list mixes the app under test with Apple system apps and the Maestro
/// driver, so we skip any bundle starting with `com.apple.` or containing
/// `maestro-driver`, then take the LAST remaining row (most recently launched).
pub fn parse_launchctl_frontmost(launchctl_list: &str) -> Option<(u32, String)> {
    const MARKER: &str = "UIKitApplication:";
    let mut found: Option<(u32, String)> = None;
    for line in launchctl_list.lines() {
        let Some(idx) = line.find(MARKER) else {
            continue;
        };
        let after = &line[idx + MARKER.len()..];
        let bundle = after.split('[').next().unwrap_or("").trim();
        if bundle.is_empty()
            || bundle.starts_with("com.apple.")
            || bundle.contains("maestro-driver")
        {
            continue;
        }
        let Some(pid) = line.split_whitespace().next().and_then(|t| t.parse().ok()) else {
            continue;
        };
        found = Some((pid, bundle.to_string()));
    }
    found
}

/// Resolve the foreground simulated app's host PID + bundle id by shelling
/// `xcrun simctl spawn <udid> launchctl list` and parsing the result.
pub fn frontmost_pid_and_bundle(udid: &str) -> AppResult<Option<(u32, String)>> {
    let out = Command::new("xcrun")
        .args(["simctl", "spawn", udid, "launchctl", "list"])
        .output()
        .map_err(AppError::Io)?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_launchctl_frontmost(&text))
}

/// Sample CPU% and resident MB for a host PID via `ps`.
pub fn sample_cpu_mem(pid: u32) -> AppResult<Option<(f32, f32)>> {
    let out = Command::new("ps")
        .args(["-o", "%cpu=,rss=", "-p", &pid.to_string()])
        .output()
        .map_err(AppError::Io)?;
    let text = String::from_utf8_lossy(&out.stdout);
    Ok(parse_ps_cpu_rss(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_cpu_and_rss() {
        let (cpu, mem) = parse_ps_cpu_rss(" 12.5 204800\n").expect("should parse");
        assert!((cpu - 12.5).abs() < 0.01, "cpu {cpu}");
        assert!((mem - 200.0).abs() < 0.01, "mem {mem}");
    }

    #[test]
    fn none_on_empty() {
        assert_eq!(parse_ps_cpu_rss("\n  \n"), None);
    }

    #[test]
    fn none_on_garbage() {
        assert_eq!(parse_ps_cpu_rss("not numbers here"), None);
    }

    #[test]
    fn frontmost_skips_system_and_driver_apps() {
        let out = "\
1729\t0\tUIKitApplication:com.apple.chrono.WidgetRenderer-Default[565c][rb-legacy]
2452\t0\tUIKitApplication:com.apple.mobilecal[ca73][rb-legacy]
2139\t0\tUIKitApplication:dev.mobile.maestro-driver-iosUITests.xctrunner[c7a5][rb-legacy]
1748\t0\tUIKitApplication:com.apple.Spotlight[b257][rb-legacy]
1900\t0\tUIKitApplication:com.example.myapp[abcd][rb-legacy]
";
        assert_eq!(
            parse_launchctl_frontmost(out),
            Some((1900, "com.example.myapp".to_string()))
        );
    }

    #[test]
    fn frontmost_none_when_only_system_apps() {
        let out = "\
1748\t0\tUIKitApplication:com.apple.Spotlight[b257][rb-legacy]
2139\t0\tUIKitApplication:dev.mobile.maestro-driver-iosUITests.xctrunner[c7a5][rb-legacy]
";
        assert_eq!(parse_launchctl_frontmost(out), None);
    }

    #[test]
    fn frontmost_picks_last_of_multiple_user_apps() {
        let out = "\
1900\t0\tUIKitApplication:com.example.first[aaaa][rb-legacy]
1950\t0\tUIKitApplication:com.example.second[bbbb][rb-legacy]
";
        assert_eq!(
            parse_launchctl_frontmost(out),
            Some((1950, "com.example.second".to_string()))
        );
    }
}
