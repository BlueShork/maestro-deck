// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

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
    Some(ProcStat {
        utime_ticks: utime,
        stime_ticks: stime,
        starttime_ticks: starttime,
    })
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
            let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
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
/// interval. `user_hz` is typically 100 on Android. Result is clamped to a
/// lower bound of 0 and returned as a percentage of a single core
/// (100% = one core saturated; 200% = two cores).
pub fn cpu_percent(prev: ProcStat, curr: ProcStat, elapsed_secs: f32, user_hz: u32) -> f32 {
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
        ProcStat {
            utime_ticks: u,
            stime_ticks: st,
            starttime_ticks: 0,
        }
    }

    #[test]
    fn full_core_usage_is_100() {
        // 1s interval, USER_HZ=100, 100 ticks consumed total → 1 full core
        let pct = cpu_percent(s(0, 0), s(80, 20), 1.0, 100);
        assert!((pct - 100.0).abs() < 0.5, "got {pct}");
    }

    #[test]
    fn half_core_usage_is_50() {
        let pct = cpu_percent(s(100, 100), s(140, 110), 1.0, 100);
        assert!((pct - 50.0).abs() < 0.5, "got {pct}");
    }

    #[test]
    fn zero_on_no_delta() {
        let pct = cpu_percent(s(100, 50), s(100, 50), 1.0, 100);
        assert_eq!(pct, 0.0);
    }

    #[test]
    fn zero_on_zero_elapsed() {
        let pct = cpu_percent(s(0, 0), s(100, 100), 0.0, 100);
        assert_eq!(pct, 0.0);
    }

    #[test]
    fn clamped_on_clock_skew() {
        // curr < prev should yield 0, not negative
        let pct = cpu_percent(s(500, 500), s(100, 100), 1.0, 100);
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
                if candidate.contains('.') && !candidate.contains('{') && !candidate.contains('=') {
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

    #[allow(non_snake_case)]
    #[test]
    fn foreground_pkg_from_mCurrentFocus() {
        let input = "  mCurrentFocus=Window{abc u0 com.example.app/com.example.app.MainActivity}\n\
                     Some other line\n";
        assert_eq!(
            parse_foreground_package(input).as_deref(),
            Some("com.example.app")
        );
    }

    #[allow(non_snake_case)]
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

pub fn parse_package_uid(dumpsys_package: &str) -> Option<u32> {
    let mut app_id: Option<u32> = None;
    let mut user_id: Option<u32> = None;
    for line in dumpsys_package.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("appId=") {
            if let Some(tok) = rest.split_whitespace().next() {
                if let Ok(v) = tok.parse::<u32>() {
                    app_id = Some(v);
                }
            }
        } else if let Some(rest) = t.strip_prefix("userId=") {
            if user_id.is_none() {
                if let Some(tok) = rest.split_whitespace().next() {
                    if let Ok(v) = tok.parse::<u32>() {
                        user_id = Some(v);
                    }
                }
            }
        }
    }
    app_id.or(user_id)
}

#[cfg(test)]
mod tests_uid {
    use super::*;

    #[allow(non_snake_case)]
    #[test]
    fn parses_userId() {
        let input = "Packages:\n  \
                     Package [com.example.app] (abcdef):\n    \
                     userId=10234\n    \
                     pkg=Package{...}\n";
        assert_eq!(parse_package_uid(input), Some(10234));
    }

    #[test]
    fn none_when_missing() {
        assert!(parse_package_uid("no uid here").is_none());
    }

    #[test]
    #[allow(non_snake_case)]
    fn prefers_appId_over_userId_on_modern_android() {
        // Android 12+: userId=0 is the user profile, appId is the real app UID
        let input = "Packages:\n  \
                     Package [com.example.app] (abcdef):\n    \
                     appId=10234\n    \
                     User 0:\n      \
                     userId=0\n      \
                     installed=true\n";
        assert_eq!(parse_package_uid(input), Some(10234));
    }

    #[test]
    fn falls_back_to_user_id_when_no_app_id() {
        // Older Android: only userId= is present, and it's the app UID
        let input = "Packages:\n  \
                     Package [com.example.app] (abcdef):\n    \
                     userId=10234\n    \
                     pkg=Package{...}\n";
        assert_eq!(parse_package_uid(input), Some(10234));
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NetBytes {
    pub rx: u64,
    pub tx: u64,
}

pub fn parse_xt_qtaguid_for_uid(stats: &str, uid: u32) -> Option<NetBytes> {
    let mut rx: u64 = 0;
    let mut tx: u64 = 0;
    let mut found = false;
    for line in stats.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 9 {
            continue;
        }
        // Column layout: 0 idx, 1 iface, 2 acct_tag_hex, 3 uid_tag_int,
        //                4 cnt_set, 5 rx_bytes, ..., 7 tx_bytes
        let tag = cols[2];
        let row_uid: u32 = match cols[3].parse() {
            Ok(v) => v,
            Err(_) => continue,
        };
        if row_uid != uid || tag != "0x0" {
            continue;
        }
        found = true;
        let row_rx: u64 = cols[5].parse().unwrap_or(0);
        let row_tx: u64 = cols[7].parse().unwrap_or(0);
        rx = rx.saturating_add(row_rx);
        tx = tx.saturating_add(row_tx);
    }
    if found {
        Some(NetBytes { rx, tx })
    } else {
        None
    }
}

#[cfg(test)]
mod tests_net {
    use super::*;

    #[test]
    fn sums_untagged_rows_for_uid() {
        let stats = "\
idx iface acct_tag_hex uid_tag_int cnt_set rx_bytes rx_packets tx_bytes tx_packets rx_tcp_bytes rx_tcp_packets rx_udp_bytes rx_udp_packets rx_other_bytes rx_other_packets tx_tcp_bytes tx_tcp_packets tx_udp_bytes tx_udp_packets tx_other_bytes tx_other_packets
2 wlan0 0x0 10234 0 5000 10 2000 8 5000 10 0 0 0 0 2000 8 0 0 0 0
3 wlan0 0x0 10234 1 1000 4 500 3 1000 4 0 0 0 0 500 3 0 0 0 0
4 wlan0 0xFFFFFF0000000000 10234 0 9999 1 9999 1 0 0 0 0 0 0 0 0 0 0 0 0
5 wlan0 0x0 99999 0 1234 1 5678 1 0 0 0 0 0 0 0 0 0 0 0 0
";
        // Untagged (0x0) rows for UID 10234: rx 5000+1000, tx 2000+500
        let n = parse_xt_qtaguid_for_uid(stats, 10234);
        assert_eq!(n, Some(NetBytes { rx: 6000, tx: 2500 }));
    }

    #[test]
    fn none_when_no_match() {
        let stats =
            "idx iface acct_tag_hex uid_tag_int cnt_set rx_bytes rx_packets tx_bytes tx_packets\n";
        assert_eq!(parse_xt_qtaguid_for_uid(stats, 42), None);
    }
}

/// Extract the first UID value from markers on a line: `uid=N`, `UID N`, `UID N:`.
/// Returns None if no recognizable UID marker is present.
fn first_uid_in_line(line: &str) -> Option<u32> {
    for marker in ["uid=", "UID "] {
        if let Some(idx) = line.find(marker) {
            let rest = &line[idx + marker.len()..];
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !digits.is_empty() {
                if let Ok(n) = digits.parse::<u32>() {
                    return Some(n);
                }
            }
        }
    }
    None
}

pub fn parse_netstats_detail_for_uid(dump: &str, uid: u32) -> Option<NetBytes> {
    let mut rx: u64 = 0;
    let mut tx: u64 = 0;
    let mut found = false;
    let mut active = false;
    for line in dump.lines() {
        // Any UID marker on the line switches active state. If no marker,
        // preserve the previous state so multi-line blocks (header + indented
        // rx/tx lines) are handled.
        if let Some(line_uid) = first_uid_in_line(line) {
            active = line_uid == uid;
        }
        if !active {
            continue;
        }
        // Scan the line for rx*/tx* byte tokens in any of the format
        // variants we've seen across Android versions.
        for tok in line.split(|c: char| c.is_whitespace() || c == ',' || c == ';') {
            let (is_rx, raw_val) = if let Some(v) = tok.strip_prefix("rxBytes=") {
                (true, v)
            } else if let Some(v) = tok.strip_prefix("rx=") {
                (true, v)
            } else if let Some(v) = tok.strip_prefix("txBytes=") {
                (false, v)
            } else if let Some(v) = tok.strip_prefix("tx=") {
                (false, v)
            } else {
                continue;
            };
            // Take leading digits only — tolerant of trailing units/punct.
            let digits: String = raw_val.chars().take_while(|c| c.is_ascii_digit()).collect();
            if digits.is_empty() {
                continue;
            }
            let n: u64 = digits.parse().unwrap_or(0);
            if is_rx {
                rx = rx.saturating_add(n);
            } else {
                tx = tx.saturating_add(n);
            }
            found = true;
        }
    }
    if found {
        Some(NetBytes { rx, tx })
    } else {
        None
    }
}

#[cfg(test)]
mod tests_netstats {
    use super::*;

    #[test]
    fn sums_rx_tx_for_uid() {
        let dump = "\
Active interfaces:
  iface=wlan0 ...
  uid=10234 set=DEFAULT tag=0x0 metered=NO roaming=NO defaultNetwork=NO
    rx=1000 rxPackets=5 tx=500 txPackets=3 rxTcp=900 rxUdp=100 txTcp=500 txUdp=0
  uid=10234 set=FOREGROUND tag=0x0 metered=NO roaming=NO defaultNetwork=NO
    rx=200 rxPackets=1 tx=100 txPackets=1
  uid=99999 set=DEFAULT tag=0x0 metered=NO roaming=NO defaultNetwork=NO
    rx=9999 rxPackets=99 tx=9999 txPackets=99
";
        let n = parse_netstats_detail_for_uid(dump, 10234);
        assert_eq!(n, Some(NetBytes { rx: 1200, tx: 600 }));
    }

    #[test]
    fn none_when_uid_missing() {
        assert_eq!(parse_netstats_detail_for_uid("nothing here", 42), None);
    }

    #[test]
    fn handles_same_line_rx_tx_with_rx_bytes_format() {
        // Android 14/15 format: single-line entry with rxBytes/txBytes
        let dump = "\
Active interfaces:
  iface=wlan0 ...
Active UID stats:
  iface=wlan0 uid=10563 set=DEFAULT tag=0x0 metered=NO rxBytes=1234 rxPackets=5 txBytes=5678 txPackets=3
  iface=wlan0 uid=10563 set=FOREGROUND tag=0x0 metered=NO rxBytes=200 rxPackets=1 txBytes=100 txPackets=1
  iface=wlan0 uid=99999 set=DEFAULT tag=0x0 metered=NO rxBytes=9999 rxPackets=9 txBytes=9999 txPackets=9
";
        let n = parse_netstats_detail_for_uid(dump, 10563);
        assert_eq!(n, Some(NetBytes { rx: 1434, tx: 5778 }));
    }

    #[test]
    fn handles_uid_header_block_format() {
        // Hypothetical newer format: "UID N:" header, indented byte lines
        let dump = "\
Active UID stats:
  UID 10563:
    rxBytes=500 txBytes=200
    rxBytes=100 txBytes=50
  UID 99999:
    rxBytes=9999 txBytes=9999
";
        let n = parse_netstats_detail_for_uid(dump, 10563);
        assert_eq!(n, Some(NetBytes { rx: 600, tx: 250 }));
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GfxStats {
    pub total_frames: u32,
    pub janky_frames: u32,
    pub p50_ms: Option<f32>,
    pub p90_ms: Option<f32>,
    pub p95_ms: Option<f32>,
    pub p99_ms: Option<f32>,
}

/// Parse the `<N>th percentile: <X>ms` value for a given percentile label.
fn parse_percentile_ms(s: &str, label: &str) -> Option<f32> {
    for line in s.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix(label) {
            let digits: String = rest
                .trim()
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == '.')
                .collect();
            if let Ok(v) = digits.parse::<f32>() {
                return Some(v);
            }
        }
    }
    None
}

pub fn parse_gfxinfo(s: &str) -> Option<GfxStats> {
    let mut total: Option<u32> = None;
    let mut janky: Option<u32> = None;
    for line in s.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Total frames rendered:") {
            total = rest.split_whitespace().next()?.parse().ok();
        } else if let Some(rest) = t.strip_prefix("Janky frames:") {
            janky = rest.split_whitespace().next()?.parse().ok();
        }
    }
    Some(GfxStats {
        total_frames: total?,
        janky_frames: janky?,
        p50_ms: parse_percentile_ms(s, "50th percentile:"),
        p90_ms: parse_percentile_ms(s, "90th percentile:"),
        p95_ms: parse_percentile_ms(s, "95th percentile:"),
        p99_ms: parse_percentile_ms(s, "99th percentile:"),
    })
}

#[cfg(test)]
mod tests_gfx {
    use super::*;

    #[test]
    fn parses_basic_gfxinfo() {
        let input = "\
Graphics info for pid 1234 [com.example.app]

  Stats since: 123456ms
  Total frames rendered: 420
  Janky frames: 38 (9.05%)
  50th percentile: 8ms
  90th percentile: 14ms
  95th percentile: 17ms
  99th percentile: 23ms
";
        let s = parse_gfxinfo(input).expect("should parse");
        assert_eq!(s.total_frames, 420);
        assert_eq!(s.janky_frames, 38);
    }

    #[test]
    fn returns_none_when_missing() {
        assert!(parse_gfxinfo("unrelated output").is_none());
    }

    #[test]
    fn returns_none_when_only_partial() {
        // Total present but janky missing — treat as None to avoid lying to UI
        assert!(parse_gfxinfo("Total frames rendered: 100\n").is_none());
    }

    #[test]
    fn parses_frame_time_percentiles() {
        let input = "\
  Total frames rendered: 420
  Janky frames: 38 (9.05%)
  50th percentile: 8ms
  90th percentile: 14ms
  95th percentile: 17ms
  99th percentile: 23ms
";
        let s = parse_gfxinfo(input).expect("should parse");
        assert_eq!(s.p50_ms, Some(8.0));
        assert_eq!(s.p90_ms, Some(14.0));
        assert_eq!(s.p95_ms, Some(17.0));
        assert_eq!(s.p99_ms, Some(23.0));
    }

    #[test]
    fn percentiles_none_when_absent() {
        let input = "  Total frames rendered: 10\n  Janky frames: 1 (10.00%)\n";
        let s = parse_gfxinfo(input).expect("should parse");
        assert_eq!(s.p50_ms, None);
        assert_eq!(s.p99_ms, None);
    }
}
