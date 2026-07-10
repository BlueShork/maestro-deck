// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Cross-platform "kill processes matching a command line" + "who owns this
//! port" helpers. Used only by the web session. Unlike the Unix-only
//! `pgrep`-based sweeps elsewhere, matching happens in Rust over a full
//! process listing, so the exact same semantics apply on macOS, Linux and
//! Windows — and the matcher is unit-testable without spawning anything.

use tracing::warn;

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

/// One `(pid, command line)` row of the process table.
async fn list_processes() -> Vec<(u32, String)> {
    #[cfg(unix)]
    let output = tokio::process::Command::new("ps")
        .args(["-axo", "pid=,command="])
        .output()
        .await;
    #[cfg(windows)]
    let output = tokio::process::Command::new("powershell")
        .no_window()
        .args([
            "-NoProfile",
            "-Command",
            // CSV keeps parsing dependency-free (no JSON shape surprises).
            "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId)\u{1f}$($_.CommandLine)\" }",
        ])
        .output()
        .await;

    let Ok(output) = output else {
        return Vec::new();
    };
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| {
            #[cfg(unix)]
            {
                let t = line.trim_start();
                let (pid, cmd) = t.split_once(' ')?;
                Some((pid.trim().parse().ok()?, cmd.trim().to_string()))
            }
            #[cfg(windows)]
            {
                let (pid, cmd) = line.split_once('\u{1f}')?;
                Some((pid.trim().parse().ok()?, cmd.trim().to_string()))
            }
        })
        .collect()
}

async fn kill_pid(pid: u32) {
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

/// The process LISTENing on a local TCP port, if any.
pub struct PortOwner {
    pub pid: u32,
    pub cmdline: String,
}

pub async fn port_owner(port: u16) -> Option<PortOwner> {
    #[cfg(unix)]
    let pid: u32 = {
        let out = tokio::process::Command::new("lsof")
            .args([
                "-nP",
                &format!("-iTCP:{port}"),
                "-sTCP:LISTEN",
                "-t", // terse: PIDs only
            ])
            .output()
            .await
            .ok()?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()?
            .trim()
            .parse()
            .ok()?
    };
    #[cfg(windows)]
    let pid: u32 = {
        let out = tokio::process::Command::new("powershell")
            .no_window()
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "(Get-NetTCPConnection -LocalPort {port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess"
                ),
            ])
            .output()
            .await
            .ok()?;
        String::from_utf8_lossy(&out.stdout).trim().parse().ok()?
    };

    let cmdline = list_processes()
        .await
        .into_iter()
        .find(|(p, _)| *p == pid)
        .map(|(_, c)| c)
        .unwrap_or_default();
    Some(PortOwner { pid, cmdline })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real command lines observed on this machine (2026-07-10).
    const IOS_STUDIO: &str = "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java -classpath /opt/homebrew/Cellar/maestro/2.5.1/libexec/lib/* maestro.cli.AppKt --device 1D5972C2-89CA-4F33-AE3D-7A9A8CD6094C studio --no-window";
    const WEB_STUDIO: &str = "/Library/Java/JavaVirtualMachines/temurin-21.jdk/Contents/Home/bin/java -classpath /opt/homebrew/Cellar/maestro/2.5.1/libexec/lib/* maestro.cli.AppKt -p web studio --no-window";

    #[test]
    fn ordered_needles_all_present_matches() {
        assert!(cmdline_matches(
            WEB_STUDIO,
            &["maestro", "-p web", "studio"]
        ));
    }

    #[test]
    fn web_needles_never_match_an_ios_studio() {
        // THE regression this module exists to prevent: a web sweep must not
        // catch a mobile studio session.
        assert!(!cmdline_matches(
            IOS_STUDIO,
            &["maestro", "-p web", "studio"]
        ));
        // …but a generic studio needle set matches both.
        assert!(cmdline_matches(IOS_STUDIO, &["maestro", "studio"]));
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
