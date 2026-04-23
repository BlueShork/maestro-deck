//! Pure parsers for /proc entries and `dumpsys` output. No I/O.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProcStat {
    pub utime_ticks: u64,
    pub stime_ticks: u64,
    pub starttime_ticks: u64,
}

pub fn parse_proc_stat(s: &str) -> Option<ProcStat> {
    let rparen = s.rfind(')')?;
    let after = s.get(rparen + 1..)?.trim_start();
    let parts: Vec<&str> = after.split_whitespace().collect();
    // Fields after comm start at index 0 = state (field 3 in proc(5)).
    // So utime (14) is at offset 14 - 3 = 11, stime (15) at 12,
    // starttime (22) at 19.
    let utime = parts.get(11)?.parse().ok()?;
    let stime = parts.get(12)?.parse().ok()?;
    let starttime = parts.get(19)?.parse().ok()?;
    Some(ProcStat { utime_ticks: utime, stime_ticks: stime, starttime_ticks: starttime })
}

#[cfg(test)]
mod tests_stat {
    use super::*;

    #[test]
    fn parses_stat_with_parens_in_comm() {
        // comm field contains spaces and parens — the realistic case
        let input = "1234 (com.example.app) S 1 1234 1234 0 -1 4194304 \
                     100 0 0 0 550 120 0 0 20 0 14 0 9876543 \
                     0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0";
        let r = parse_proc_stat(input).expect("should parse");
        assert_eq!(r.utime_ticks, 550);
        assert_eq!(r.stime_ticks, 120);
        assert_eq!(r.starttime_ticks, 9876543);
    }

    #[test]
    fn returns_none_on_garbage() {
        assert!(parse_proc_stat("not a stat line").is_none());
    }

    #[test]
    fn returns_none_when_too_short() {
        assert!(parse_proc_stat("1 (x) S 2 3").is_none());
    }
}

/// Returns VmRSS in megabytes, rounded to 1 decimal (via f32). Android /proc reports kB.
pub fn parse_vm_rss_mb(s: &str) -> Option<f32> {
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest.trim().split_whitespace().next()?.parse().ok()?;
            return Some(kb as f32 / 1024.0);
        }
    }
    None
}

#[cfg(test)]
mod tests_status {
    use super::*;

    #[test]
    fn parses_vm_rss_in_kb() {
        let input = "Name:\tcom.example.app\n\
                     State:\tS (sleeping)\n\
                     Tgid:\t1234\n\
                     VmPeak:\t  5120000 kB\n\
                     VmSize:\t  4096000 kB\n\
                     VmRSS:\t   204800 kB\n\
                     Threads:\t32\n";
        let mb = parse_vm_rss_mb(input).expect("should parse");
        assert!((mb - 200.0).abs() < 0.01, "got {mb}");
    }

    #[test]
    fn returns_none_when_missing() {
        assert!(parse_vm_rss_mb("Name: x\nState: S\n").is_none());
    }
}

/// Compute CPU % between two /proc/stat samples over an elapsed wall-clock
/// interval. `user_hz` is typically 100 on Android. `cores` is the number of
/// online CPU cores. Result is clamped to [0, 100 * cores] and returned as a
/// percentage of a single core (100% = one core saturated).
pub fn cpu_percent(
    prev: ProcStat,
    curr: ProcStat,
    elapsed_secs: f32,
    user_hz: u32,
    _cores: u32,
) -> f32 {
    if elapsed_secs <= 0.0 || user_hz == 0 {
        return 0.0;
    }
    let d_user = curr.utime_ticks.saturating_sub(prev.utime_ticks);
    let d_sys = curr.stime_ticks.saturating_sub(prev.stime_ticks);
    let delta_ticks = (d_user + d_sys) as f32;
    let wall_ticks = elapsed_secs * user_hz as f32;
    if wall_ticks <= 0.0 {
        return 0.0;
    }
    (delta_ticks / wall_ticks * 100.0).max(0.0)
}

#[cfg(test)]
mod tests_cpu {
    use super::*;

    fn s(u: u64, st: u64) -> ProcStat {
        ProcStat { utime_ticks: u, stime_ticks: st, starttime_ticks: 0 }
    }

    #[test]
    fn full_core_usage_is_100() {
        // 1s interval, USER_HZ=100, 100 ticks consumed total → 1 full core
        let pct = cpu_percent(s(0, 0), s(80, 20), 1.0, 100, 4);
        assert!((pct - 100.0).abs() < 0.5, "got {pct}");
    }

    #[test]
    fn half_core_usage_is_50() {
        let pct = cpu_percent(s(100, 100), s(140, 110), 1.0, 100, 4);
        assert!((pct - 50.0).abs() < 0.5, "got {pct}");
    }

    #[test]
    fn zero_on_no_delta() {
        let pct = cpu_percent(s(100, 50), s(100, 50), 1.0, 100, 4);
        assert_eq!(pct, 0.0);
    }

    #[test]
    fn zero_on_zero_elapsed() {
        let pct = cpu_percent(s(0, 0), s(100, 100), 0.0, 100, 4);
        assert_eq!(pct, 0.0);
    }

    #[test]
    fn clamped_on_clock_skew() {
        // curr < prev should yield 0, not negative
        let pct = cpu_percent(s(500, 500), s(100, 100), 1.0, 100, 4);
        assert_eq!(pct, 0.0);
    }
}

pub fn parse_pidof(s: &str) -> Option<u32> {
    s.split_whitespace().next()?.parse().ok()
}

pub fn parse_foreground_package(dumpsys_window: &str) -> Option<String> {
    for line in dumpsys_window.lines() {
        let key = if let Some(idx) = line.find("mCurrentFocus=") {
            &line[idx..]
        } else if let Some(idx) = line.find("mFocusedApp=") {
            &line[idx..]
        } else {
            continue;
        };
        // Look for "<pkg>/<activity>" pattern inside the line
        for tok in key.split_whitespace() {
            if let Some(slash) = tok.find('/') {
                let candidate = &tok[..slash];
                // Filter out brace-prefixed junk like "Window{xxx"
                if candidate.contains('.')
                    && !candidate.contains('{')
                    && !candidate.contains('=')
                {
                    return Some(candidate.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests_foreground {
    use super::*;

    #[test]
    fn pidof_single_pid() {
        assert_eq!(parse_pidof("1234\n"), Some(1234));
    }

    #[test]
    fn pidof_first_of_multiple() {
        // Multiple processes: take the first
        assert_eq!(parse_pidof("1234 5678\n"), Some(1234));
    }

    #[test]
    fn pidof_empty_is_none() {
        assert_eq!(parse_pidof(""), None);
        assert_eq!(parse_pidof("\n"), None);
    }

    #[test]
    fn foreground_pkg_from_mCurrentFocus() {
        let input = "  mCurrentFocus=Window{abc u0 com.example.app/com.example.app.MainActivity}\n\
                     Some other line\n";
        assert_eq!(
            parse_foreground_package(input).as_deref(),
            Some("com.example.app")
        );
    }

    #[test]
    fn foreground_pkg_handles_mFocusedApp() {
        // Fallback key on some Android versions
        let input = "  mFocusedApp=ActivityRecord{deadbeef u0 com.example.app/.Main t5}\n";
        assert_eq!(
            parse_foreground_package(input).as_deref(),
            Some("com.example.app")
        );
    }

    #[test]
    fn foreground_pkg_none_when_absent() {
        assert!(parse_foreground_package("nothing relevant here").is_none());
    }
}
