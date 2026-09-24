// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Cross-platform "kill processes matching a command line" + "find a
//! process's descendants" helpers, used by the maestro keepers' orphan
//! sweeps and the web session. Matching happens in Rust over a full
//! process listing, so the exact same semantics apply on macOS, Linux and
//! Windows — and the matcher is unit-testable without spawning anything.

use tracing::warn;

// Only the Windows subprocess calls need the no-window flag; on Unix the
// import would be unused and trip `-D warnings`.
#[cfg(windows)]
use crate::process_ext::CommandExtNoWindow;

/// True if every needle appears in `cmdline`, in order. Substrings, not
/// regex — identical semantics on every OS and trivially testable.
pub fn cmdline_matches(cmdline: &str, needles: &[&str]) -> bool {
    if needles.is_empty() {
        return false;
    }
    let mut rest = cmdline;
    for needle in needles {
        match rest.find(needle) {
            Some(i) => rest = &rest[i + needle.len()..],
            None => return false,
        }
    }
    true
}

/// One `(pid, parent pid, command line)` row per process.
async fn list_processes_with_parents() -> Vec<(u32, u32, String)> {
    #[cfg(unix)]
    let output = tokio::process::Command::new("ps")
        .args(["-axo", "pid=,ppid=,command="])
        .output()
        .await;
    #[cfg(windows)]
    let output = tokio::process::Command::new("powershell")
        .no_window()
        .args([
            "-NoProfile",
            "-Command",
            // CSV keeps parsing dependency-free (no JSON shape surprises).
            "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)\u{1f}$($_.ParentProcessId)\u{1f}$($_.CommandLine)\" }",
        ])
        .output()
        .await;

    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_process_row)
        .collect()
}

fn parse_process_row(line: &str) -> Option<(u32, u32, String)> {
    #[cfg(unix)]
    {
        let t = line.trim_start();
        let (pid, rest) = t.split_once(' ')?;
        let rest = rest.trim_start();
        let (ppid, cmd) = rest.split_once(' ').unwrap_or((rest, ""));
        Some((
            pid.trim().parse().ok()?,
            ppid.trim().parse().ok()?,
            cmd.trim().to_string(),
        ))
    }
    #[cfg(windows)]
    {
        let mut parts = line.splitn(3, '\u{1f}');
        let pid = parts.next()?.trim().parse().ok()?;
        let ppid = parts.next()?.trim().parse().ok()?;
        Some((pid, ppid, parts.next().unwrap_or("").trim().to_string()))
    }
}

/// One `(pid, command line)` row of the process table.
async fn list_processes() -> Vec<(u32, String)> {
    list_processes_with_parents()
        .await
        .into_iter()
        .map(|(pid, _, cmd)| (pid, cmd))
        .collect()
}

/// True if `pid` descends from `ancestor` (at any depth) in `table`.
fn descends_from(table: &[(u32, u32, String)], mut pid: u32, ancestor: u32) -> bool {
    // Bounded walk: a pid-reuse cycle in a stale table must not spin forever.
    for _ in 0..32 {
        let Some((_, ppid, _)) = table.iter().find(|(p, _, _)| *p == pid) else {
            return false;
        };
        if *ppid == ancestor {
            return true;
        }
        if *ppid == 0 || *ppid == pid {
            return false;
        }
        pid = *ppid;
    }
    false
}

/// `(pid, command line)` of every descendant of `ancestor` whose command line
/// matches `needles` (in order).
pub async fn descendants_matching(ancestor: u32, needles: &[&str]) -> Vec<(u32, String)> {
    let table = list_processes_with_parents().await;
    table
        .iter()
        .filter(|(pid, _, cmd)| {
            cmdline_matches(cmd, needles) && descends_from(&table, *pid, ancestor)
        })
        .map(|(pid, _, cmd)| (*pid, cmd.clone()))
        .collect()
}

pub(crate) async fn kill_pid(pid: u32) {
    #[cfg(unix)]
    let _ = tokio::process::Command::new("kill")
        .args(["-9", &pid.to_string()])
        .output()
        .await;
    #[cfg(windows)]
    let _ = tokio::process::Command::new("taskkill")
        .no_window()
        .args(["/F", "/PID", &pid.to_string()])
        .output()
        .await;
}

/// `(pid, command line)` of every process matching `needles` (in order),
/// excluding our own. Best-effort: an unreadable process table yields empty.
pub async fn pids_matching(needles: &[&str]) -> Vec<(u32, String)> {
    let me = std::process::id();
    list_processes()
        .await
        .into_iter()
        .filter(|(pid, cmdline)| *pid != me && cmdline_matches(cmdline, needles))
        .collect()
}

/// Kill every process whose command line matches `needles` (in order).
/// Skips our own process. Best-effort: listing or kill failures are ignored.
pub async fn kill_matching(needles: &[&str], reason: &str) {
    let me = std::process::id();
    for (pid, cmdline) in list_processes().await {
        if pid == me || !cmdline_matches(&cmdline, needles) {
            continue;
        }
        warn!(pid, reason, "killing process matching web-session sweep");
        kill_pid(pid).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real command lines observed on this machine (2026-09-24, maestro 2.10.0).
    const IOS_KEEPER: &str = "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java --enable-native-access=ALL-UNNAMED -classpath /opt/homebrew/Cellar/maestro/2.10.0/libexec/lib/* maestro.cli.AppKt --device 1D5972C2-89CA-4F33-AE3D-7A9A8CD6094C mcp --no-viewer";
    const WEB_KEEPER: &str = "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java --enable-native-access=ALL-UNNAMED -classpath /opt/homebrew/Cellar/maestro/2.10.0/libexec/lib/* maestro.cli.AppKt -p web mcp --no-viewer";

    #[test]
    fn ordered_needles_all_present_matches() {
        assert!(cmdline_matches(WEB_KEEPER, &["maestro", "-p web", "mcp"]));
    }

    #[test]
    fn web_needles_never_match_an_ios_keeper() {
        // THE regression this module exists to prevent: a web sweep must not
        // catch a mobile keeper session.
        assert!(!cmdline_matches(IOS_KEEPER, &["maestro", "-p web", "mcp"]));
        // …but a generic mcp needle set matches both.
        assert!(cmdline_matches(IOS_KEEPER, &["maestro", "mcp"]));
    }

    #[test]
    fn walks_the_parent_chain() {
        // java(10) → chromedriver(20) → chrome(30); unrelated(40) under init.
        let table = vec![
            (10, 1, "java".to_string()),
            (20, 10, "chromedriver".to_string()),
            (30, 20, "chrome".to_string()),
            (40, 1, "chrome".to_string()),
        ];
        assert!(descends_from(&table, 30, 10));
        assert!(descends_from(&table, 20, 10));
        assert!(!descends_from(&table, 40, 10));
        assert!(!descends_from(&table, 10, 10));
        assert!(!descends_from(&table, 99, 10));
    }

    #[cfg(unix)]
    #[test]
    fn parses_ps_rows_with_parent() {
        assert_eq!(
            parse_process_row("  123   45 /usr/bin/java -cp x maestro.cli.AppKt mcp"),
            Some((
                123,
                45,
                "/usr/bin/java -cp x maestro.cli.AppKt mcp".to_string()
            ))
        );
        assert_eq!(parse_process_row("  7 1"), Some((7, 1, String::new())));
        assert_eq!(parse_process_row("garbage"), None);
    }

    #[test]
    fn needles_must_appear_in_order() {
        assert!(cmdline_matches("a b c", &["a", "c"]));
        assert!(!cmdline_matches("c b a", &["a", "c"]));
    }

    #[test]
    fn chromedriver_needles_match_both_path_separators() {
        // macOS selenium cache path…
        assert!(cmdline_matches(
            "/Users/x/.cache/selenium/chromedriver/mac-arm64/chromedriver --port=52123",
            &["selenium", "chromedriver"]
        ));
        // …and the Windows one (backslashes).
        assert!(cmdline_matches(
            r"C:\Users\x\.cache\selenium\chromedriver\win64\chromedriver.exe --port=52123",
            &["selenium", "chromedriver"]
        ));
    }

    #[test]
    fn empty_needles_never_match() {
        assert!(!cmdline_matches("anything", &[]));
    }
}
