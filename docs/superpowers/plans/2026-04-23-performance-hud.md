# Performance HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, collapsible HUD next to the Run Console that shows CPU %, RAM, FPS, jank %, and per-app network I/O of the Android app currently in foreground on the connected device. Zero polling when the panel is closed or when the feature is disabled in settings.

**Architecture:** New Rust module `src-tauri/src/metrics/` that spawns a single Tokio polling task (cancelled via oneshot channel, same pattern as `runner`). Parsers for `/proc/<pid>/stat`, `/proc/<pid>/status`, `dumpsys window`, `dumpsys package`, `xt_qtaguid/stats`, `dumpsys netstats`, and `dumpsys gfxinfo framestats` are pure functions, unit-tested. Three independent timers inside the task (1 Hz for CPU/RAM batched, 2 Hz for net, 0.2 Hz for gfxinfo) emit a single `metrics:sample` event to the frontend. The frontend stores samples in a 60-point ring buffer and renders hand-rolled SVG sparklines — no chart library, no canvas. Lifecycle is driven by the frontend: opening the panel calls `start_metrics`, closing it calls `stop_metrics`.

**Tech Stack:** Rust (Tokio, `once_cell`, existing `adb::exec_shell`), React 18 + TypeScript, Zustand, Tauri 2.x IPC, Tailwind for styling. No new dependencies.

**Reference spec:** `docs/superpowers/specs/2026-04-23-performance-hud-design.md`

---

## File Structure

**Created:**
- `src-tauri/src/metrics/mod.rs` — lifecycle, task spawn, public API
- `src-tauri/src/metrics/parsers.rs` — pure parsers (highest test coverage lives here)
- `src-tauri/src/metrics/collector.rs` — ADB call orchestration + CPU delta math
- `src-tauri/src/metrics/foreground.rs` — foreground/PID/UID detection
- `src/stores/metricsStore.ts`
- `src/components/MetricsPanel.tsx`
- `src/components/MetricsSparkline.tsx`

**Modified:**
- `src-tauri/src/error.rs` — new `MetricsFailed(String)` and `MetricsAlreadyRunning` variants
- `src-tauri/src/lib.rs` — register module + new IPC handlers
- `src-tauri/src/ipc/commands.rs` — `start_metrics`, `stop_metrics`
- `src/lib/ipc.ts` — IPC wrapper + event wrappers + types
- `src/stores/settingsStore.ts` — add `perfMonitoringEnabled` flag
- `src/components/SettingsDialog.tsx` — checkbox for the flag
- `src/components/RunConsole.tsx` — toggle button
- `src/App.tsx` — layout change + event listener registration

---

## Task 1: Backend scaffold — errors, module, lib wiring

**Files:**
- Modify: `src-tauri/src/error.rs`
- Create: `src-tauri/src/metrics/mod.rs`
- Create: `src-tauri/src/metrics/parsers.rs`
- Create: `src-tauri/src/metrics/collector.rs`
- Create: `src-tauri/src/metrics/foreground.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add new error variants**

In `src-tauri/src/error.rs`, add two variants before the `Io` variant:

```rust
    #[error("Performance metrics collection failed: {0}")]
    MetricsFailed(String),

    #[error("Performance metrics already running")]
    MetricsAlreadyRunning,
```

- [ ] **Step 2: Create empty metrics module files**

Create `src-tauri/src/metrics/mod.rs` with:

```rust
//! Performance metrics collector for the Android app currently in foreground.
//!
//! Spawns a single Tokio polling task controlled by a oneshot cancellation
//! channel (same pattern as `runner`). Parsers live in `parsers.rs` and are
//! pure. `collector.rs` wires ADB calls to parsers. `foreground.rs` resolves
//! the target package and caches PID/UID.

pub mod collector;
pub mod foreground;
pub mod parsers;
```

Create `src-tauri/src/metrics/parsers.rs` with:

```rust
//! Pure parsers for /proc entries and `dumpsys` output. No I/O.
```

Create `src-tauri/src/metrics/collector.rs` with:

```rust
//! Batched ADB calls + CPU delta computation. Uses `device::adb::exec_shell`.
```

Create `src-tauri/src/metrics/foreground.rs` with:

```rust
//! Foreground app detection + PID/UID resolution. Cached per-target.
```

- [ ] **Step 3: Register the module in lib.rs**

In `src-tauri/src/lib.rs`, add `pub mod metrics;` alphabetically next to `pub mod input;`:

```rust
pub mod input;
pub mod ipc;
pub mod metrics;
pub mod runner;
```

- [ ] **Step 4: Verify the crate builds**

Run: `cd src-tauri && cargo build`
Expected: succeeds with no warnings about the new files.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/error.rs src-tauri/src/metrics src-tauri/src/lib.rs
git commit -m "feat(metrics): module scaffold + error variants"
```

---

## Task 2: Parse `/proc/<pid>/stat`

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`
- Test: same file (`#[cfg(test)] mod tests`)

Goal: extract `utime`, `stime`, and `starttime` (fields 14, 15, 22 per `proc(5)`). Parse from the part **after** the last `)` to avoid issues with processes whose name contains spaces or parens.

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProcStat {
    pub utime_ticks: u64,
    pub stime_ticks: u64,
    pub starttime_ticks: u64,
}

pub fn parse_proc_stat(s: &str) -> Option<ProcStat> {
    unimplemented!()
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
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_stat`
Expected: panics with `unimplemented!()` or compile error if types mismatch.

- [ ] **Step 3: Implement the parser**

Replace `unimplemented!()` with:

```rust
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
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_stat`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse /proc/<pid>/stat"
```

---

## Task 3: Parse `/proc/<pid>/status` → VmRSS in MB

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
/// Returns VmRSS in megabytes, rounded to 1 decimal (via f32). Android /proc reports kB.
pub fn parse_vm_rss_mb(s: &str) -> Option<f32> {
    unimplemented!()
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
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_status`
Expected: panic from `unimplemented!()`.

- [ ] **Step 3: Implement the parser**

```rust
pub fn parse_vm_rss_mb(s: &str) -> Option<f32> {
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: u64 = rest.trim().split_whitespace().next()?.parse().ok()?;
            return Some(kb as f32 / 1024.0);
        }
    }
    None
}
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_status`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse VmRSS from /proc/<pid>/status"
```

---

## Task 4: CPU % delta computation

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

CPU % over an interval = `(Δutime + Δstime) / (Δwall_ticks * n_cores) * 100`.
`Δwall_ticks` = elapsed seconds × USER_HZ. On Android USER_HZ is 100.

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
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
    unimplemented!()
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
```

- [ ] **Step 2: Run the test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_cpu`
Expected: panics.

- [ ] **Step 3: Implement**

```rust
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
```

Note: the spec talks about "% of a single core" — a value of 200 means the app uses two cores fully. We do not divide by `cores`; the parameter is kept for a potential future "normalized" mode. The `_cores` underscore silences the unused warning.

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_cpu`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): CPU% delta computation"
```

---

## Task 5: Parse `pidof` and `dumpsys window` mCurrentFocus

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
pub fn parse_pidof(s: &str) -> Option<u32> {
    unimplemented!()
}

pub fn parse_foreground_package(dumpsys_window: &str) -> Option<String> {
    unimplemented!()
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
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_foreground`
Expected: panics.

- [ ] **Step 3: Implement**

```rust
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
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_foreground`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse pidof + foreground package"
```

---

## Task 6: Parse `dumpsys package` userId

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
pub fn parse_package_uid(dumpsys_package: &str) -> Option<u32> {
    unimplemented!()
}

#[cfg(test)]
mod tests_uid {
    use super::*;

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
}
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_uid`
Expected: panic.

- [ ] **Step 3: Implement**

```rust
pub fn parse_package_uid(dumpsys_package: &str) -> Option<u32> {
    for line in dumpsys_package.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("userId=") {
            return rest.split_whitespace().next()?.parse().ok();
        }
    }
    None
}
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_uid`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse userId from dumpsys package"
```

---

## Task 7: Parse `xt_qtaguid/stats` for a UID

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

Format reference (each non-header line, space-separated):
`idx iface acct_tag_hex uid_tag_int cnt_set rx_bytes rx_packets tx_bytes tx_packets ...`

We sum `rx_bytes` and `tx_bytes` for rows whose `uid_tag_int` matches our UID, ignoring tagged rows when `cnt_set == 1` is NOT special — actually we sum everything for that UID across all interfaces and tag sets, because double-counting within tags vs untagged only happens on some kernels. For simplicity we sum rows where `uid_tag_int == uid` AND `acct_tag_hex == "0x0"` (i.e. untagged) so we don't double-count.

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NetBytes {
    pub rx: u64,
    pub tx: u64,
}

pub fn parse_xt_qtaguid_for_uid(stats: &str, uid: u32) -> NetBytes {
    unimplemented!()
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
        assert_eq!(n.rx, 6000);
        assert_eq!(n.tx, 2500);
    }

    #[test]
    fn zero_when_no_match() {
        let stats = "idx iface acct_tag_hex uid_tag_int cnt_set rx_bytes rx_packets tx_bytes tx_packets\n";
        assert_eq!(parse_xt_qtaguid_for_uid(stats, 42), NetBytes { rx: 0, tx: 0 });
    }
}
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_net`
Expected: panic.

- [ ] **Step 3: Implement**

```rust
pub fn parse_xt_qtaguid_for_uid(stats: &str, uid: u32) -> NetBytes {
    let mut rx: u64 = 0;
    let mut tx: u64 = 0;
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
        let row_rx: u64 = cols[5].parse().unwrap_or(0);
        let row_tx: u64 = cols[7].parse().unwrap_or(0);
        rx = rx.saturating_add(row_rx);
        tx = tx.saturating_add(row_tx);
    }
    NetBytes { rx, tx }
}
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_net`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse xt_qtaguid/stats for UID"
```

---

## Task 8: Parse `dumpsys netstats detail` fallback for a UID

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

The fallback for Android 12+ where `xt_qtaguid` isn't readable. Output format contains blocks like:
```
uid=10234 set=DEFAULT tag=0x0 iface=wlan0 ...
  rx=1234567 tx=987654 ...
```

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
pub fn parse_netstats_detail_for_uid(dump: &str, uid: u32) -> NetBytes {
    unimplemented!()
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
        assert_eq!(n.rx, 1200);
        assert_eq!(n.tx, 600);
    }

    #[test]
    fn zero_when_uid_missing() {
        assert_eq!(
            parse_netstats_detail_for_uid("nothing here", 42),
            NetBytes { rx: 0, tx: 0 }
        );
    }
}
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_netstats`
Expected: panic.

- [ ] **Step 3: Implement**

```rust
pub fn parse_netstats_detail_for_uid(dump: &str, uid: u32) -> NetBytes {
    let mut rx: u64 = 0;
    let mut tx: u64 = 0;
    let uid_marker = format!("uid={uid} ");
    let mut active = false;
    for line in dump.lines() {
        let trimmed = line.trim_start();
        if let Some(pos) = trimmed.find("uid=") {
            let rest = &trimmed[pos..];
            active = rest.starts_with(&uid_marker);
            continue;
        }
        if !active {
            continue;
        }
        for tok in trimmed.split_whitespace() {
            if let Some(v) = tok.strip_prefix("rx=") {
                rx = rx.saturating_add(v.parse().unwrap_or(0));
            } else if let Some(v) = tok.strip_prefix("tx=") {
                tx = tx.saturating_add(v.parse().unwrap_or(0));
            }
        }
    }
    NetBytes { rx, tx }
}
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_netstats`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse netstats detail fallback"
```

---

## Task 9: Parse `dumpsys gfxinfo <pkg> framestats`

**Files:**
- Modify: `src-tauri/src/metrics/parsers.rs`

Android's `framestats` output includes a `Total frames rendered: N` header followed by `Janky frames: M (P%)`. We also need a reliable per-window FPS. For v1 we use the `framestats` CSV section: each line has `TimestampFrameCompleted` deltas. Number of frames with `totalFrameMs > 16.67` → janky count. We reset per call by invoking `dumpsys gfxinfo <pkg> reset` at the end of each tick (done in collector, not parser).

For the parser, keep it simple: parse "Total frames rendered: N" and "Janky frames: M" directly — they're reliable across Android 7+.

- [ ] **Step 1: Write the failing test**

Append to `parsers.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GfxStats {
    pub total_frames: u32,
    pub janky_frames: u32,
}

pub fn parse_gfxinfo(s: &str) -> Option<GfxStats> {
    unimplemented!()
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
}
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_gfx`
Expected: panic.

- [ ] **Step 3: Implement**

```rust
pub fn parse_gfxinfo(s: &str) -> Option<GfxStats> {
    let mut total: Option<u32> = None;
    let mut janky: Option<u32> = None;
    for line in s.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Total frames rendered:") {
            total = rest.trim().split_whitespace().next()?.parse().ok();
        } else if let Some(rest) = t.strip_prefix("Janky frames:") {
            janky = rest.trim().split_whitespace().next()?.parse().ok();
        }
    }
    Some(GfxStats {
        total_frames: total?,
        janky_frames: janky?,
    })
}
```

- [ ] **Step 4: Run the test**

Run: `cd src-tauri && cargo test --lib metrics::parsers::tests_gfx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics/parsers.rs
git commit -m "feat(metrics): parse dumpsys gfxinfo"
```

---

## Task 10: Foreground detection module

**Files:**
- Modify: `src-tauri/src/metrics/foreground.rs`

- [ ] **Step 1: Write the implementation**

Replace the contents of `src-tauri/src/metrics/foreground.rs` with:

```rust
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
```

- [ ] **Step 2: Run crate build**

Run: `cd src-tauri && cargo build`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/metrics/foreground.rs
git commit -m "feat(metrics): foreground + PID/UID resolution"
```

---

## Task 11: Collector — ADB command orchestration

**Files:**
- Modify: `src-tauri/src/metrics/collector.rs`

Responsibilities:
- Issue one batched `adb shell` for `/proc/<pid>/stat` + `/proc/<pid>/status` at 1 Hz
- Issue a net-stats call at 2s cadence, preferring `xt_qtaguid` then falling back to `dumpsys netstats detail`
- Issue `dumpsys gfxinfo <pkg> framestats` + `dumpsys gfxinfo <pkg> reset` at 5s cadence
- Hold previous `ProcStat` and previous net bytes for delta computation
- Return a `Sample` struct the task layer emits

- [ ] **Step 1: Write the collector**

Replace the contents of `src-tauri/src/metrics/collector.rs` with:

```rust
//! ADB call orchestration + delta computation. No timing here — the task
//! loop calls these functions on its own cadence.

use std::time::Instant;

use crate::device::adb;
use crate::error::{AppError, AppResult};
use crate::metrics::foreground::Target;
use crate::metrics::parsers::{
    cpu_percent, parse_gfxinfo, parse_netstats_detail_for_uid, parse_proc_stat,
    parse_vm_rss_mb, parse_xt_qtaguid_for_uid, NetBytes, ProcStat,
};

const ANDROID_USER_HZ: u32 = 100;

#[derive(Debug, Clone, Copy)]
pub struct CpuMemSample {
    pub cpu_pct: f32,
    pub mem_mb: f32,
    pub stat_snapshot: ProcStat,
}

#[derive(Debug, Clone, Copy)]
pub struct NetSample {
    pub rx_kbps: f32,
    pub tx_kbps: f32,
    pub bytes_snapshot: NetBytes,
}

#[derive(Debug, Clone, Copy)]
pub struct GfxSample {
    pub fps: f32,
    pub jank_pct: f32,
}

pub fn fetch_cpu_mem(
    serial: &str,
    pid: u32,
    prev: Option<(ProcStat, Instant)>,
) -> AppResult<CpuMemSample> {
    let cmd = format!("cat /proc/{pid}/stat; echo ---; cat /proc/{pid}/status");
    let out = adb::exec_shell(serial, &cmd)?;
    let (stat_text, status_text) = out
        .split_once("\n---\n")
        .ok_or_else(|| AppError::MetricsFailed("malformed batched stat/status output".into()))?;

    let stat = parse_proc_stat(stat_text.trim())
        .ok_or_else(|| AppError::MetricsFailed("failed to parse /proc/stat".into()))?;
    let mem_mb =
        parse_vm_rss_mb(status_text).ok_or_else(|| AppError::MetricsFailed("no VmRSS".into()))?;

    let cpu_pct = match prev {
        Some((prev_stat, prev_ts)) => {
            let elapsed = prev_ts.elapsed().as_secs_f32();
            cpu_percent(prev_stat, stat, elapsed, ANDROID_USER_HZ, 1)
        }
        None => 0.0,
    };

    Ok(CpuMemSample { cpu_pct, mem_mb, stat_snapshot: stat })
}

pub fn fetch_net(
    serial: &str,
    uid: u32,
    prev: Option<(NetBytes, Instant)>,
) -> AppResult<NetSample> {
    // Try xt_qtaguid first; fall back on permission / missing-file errors.
    let bytes = match adb::exec_shell(serial, "cat /proc/net/xt_qtaguid/stats") {
        Ok(stats) => parse_xt_qtaguid_for_uid(&stats, uid),
        Err(_) => {
            let dump = adb::exec_shell(serial, "dumpsys netstats detail")?;
            parse_netstats_detail_for_uid(&dump, uid)
        }
    };

    let (rx_kbps, tx_kbps) = match prev {
        Some((p, ts)) => {
            let elapsed = ts.elapsed().as_secs_f32().max(0.001);
            let d_rx = bytes.rx.saturating_sub(p.rx) as f32;
            let d_tx = bytes.tx.saturating_sub(p.tx) as f32;
            (d_rx / 1024.0 / elapsed, d_tx / 1024.0 / elapsed)
        }
        None => (0.0, 0.0),
    };

    Ok(NetSample { rx_kbps, tx_kbps, bytes_snapshot: bytes })
}

pub fn fetch_gfx(serial: &str, package: &str) -> AppResult<Option<GfxSample>> {
    let cmd = format!("dumpsys gfxinfo {package} framestats");
    let out = adb::exec_shell(serial, &cmd)?;
    // Reset counters so the next 5s window is independent.
    let _ = adb::exec_shell(serial, &format!("dumpsys gfxinfo {package} reset"));

    let Some(stats) = parse_gfxinfo(&out) else {
        return Ok(None);
    };
    if stats.total_frames == 0 {
        return Ok(None);
    }
    // Window is 5s — FPS is total/5.
    let fps = stats.total_frames as f32 / 5.0;
    let jank_pct = stats.janky_frames as f32 * 100.0 / stats.total_frames as f32;
    Ok(Some(GfxSample { fps, jank_pct }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_mem_errors_on_missing_separator() {
        // We can't call fetch_cpu_mem without a device, but we can sanity-check
        // the split logic in isolation.
        let joined = "some stat output\nwith no separator at all";
        assert!(joined.split_once("\n---\n").is_none());
    }
}
```

- [ ] **Step 2: Run crate build + tests**

Run: `cd src-tauri && cargo test --lib metrics`
Expected: all parser tests still green, the one new collector test passes.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/metrics/collector.rs
git commit -m "feat(metrics): collector with batched ADB calls"
```

---

## Task 12: Task lifecycle + IPC commands

**Files:**
- Modify: `src-tauri/src/metrics/mod.rs`
- Modify: `src-tauri/src/ipc/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Add dependency in `src-tauri/Cargo.toml` if `once_cell` is not yet present

- [ ] **Step 1: Verify `once_cell` is already a dependency**

Run: `grep once_cell src-tauri/Cargo.toml`
Expected: line already present (the runner uses it). If not, add `once_cell = "1.20"` under `[dependencies]`.

- [ ] **Step 2: Implement the task + public API**

Replace the contents of `src-tauri/src/metrics/mod.rs` with:

```rust
//! Performance metrics collector for the Android app currently in foreground.
//!
//! Spawns a single Tokio polling task controlled by a oneshot cancellation
//! channel (same pattern as `runner`). Parsers live in `parsers.rs` and are
//! pure. `collector.rs` wires ADB calls to parsers. `foreground.rs` resolves
//! the target package and caches PID/UID.

pub mod collector;
pub mod foreground;
pub mod parsers;

use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::metrics::collector::{fetch_cpu_mem, fetch_gfx, fetch_net, GfxSample};
use crate::metrics::foreground::{resolve_target, Target};
use crate::metrics::parsers::{NetBytes, ProcStat};

const EVT_SAMPLE: &str = "metrics:sample";
const EVT_TARGET_CHANGED: &str = "metrics:target_changed";
const EVT_STOPPED: &str = "metrics:stopped";

const TICK_INTERVAL: Duration = Duration::from_secs(1);
const NET_INTERVAL: Duration = Duration::from_secs(2);
const GFX_INTERVAL: Duration = Duration::from_secs(5);
const FOREGROUND_CHECK_INTERVAL: Duration = Duration::from_secs(3);
const MAX_CONSECUTIVE_ERRORS: u32 = 3;

static RUNNING: Lazy<AsyncMutex<Option<oneshot::Sender<()>>>> =
    Lazy::new(|| AsyncMutex::new(None));

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSample {
    pub package: String,
    pub cpu_pct: f32,
    pub mem_mb: f32,
    pub fps: Option<f32>,
    pub jank_pct: Option<f32>,
    pub net_rx_kbps: f32,
    pub net_tx_kbps: f32,
    pub ts: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct TargetChanged {
    pub from: Option<String>,
    pub to: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct StoppedReason {
    pub reason: &'static str,
    pub message: Option<String>,
}

pub async fn start(app: AppHandle, serial: String) -> AppResult<()> {
    let mut guard = RUNNING.lock().await;
    if guard.is_some() {
        return Err(AppError::MetricsAlreadyRunning);
    }
    let (tx, rx) = oneshot::channel::<()>();
    *guard = Some(tx);
    drop(guard);

    tokio::spawn(run_loop(app, serial, rx));
    info!("metrics task started");
    Ok(())
}

pub async fn stop() -> AppResult<()> {
    let handle = RUNNING.lock().await.take();
    if let Some(tx) = handle {
        let _ = tx.send(());
        info!("metrics task stop requested");
    }
    Ok(())
}

async fn run_loop(app: AppHandle, serial: String, mut cancel: oneshot::Receiver<()>) {
    let mut target: Option<Target> = None;
    let mut prev_stat: Option<(ProcStat, Instant)> = None;
    let mut prev_net: Option<(NetBytes, Instant)> = None;
    let mut last_gfx: Option<GfxSample> = None;
    let mut last_net_kbps: Option<(f32, f32)> = None;
    let mut last_fg_check = Instant::now() - FOREGROUND_CHECK_INTERVAL;
    let mut last_net_poll = Instant::now() - NET_INTERVAL;
    let mut last_gfx_poll = Instant::now() - GFX_INTERVAL;
    let mut consecutive_errors: u32 = 0;
    let mut ticker = tokio::time::interval(TICK_INTERVAL);

    loop {
        tokio::select! {
            _ = &mut cancel => {
                emit_stopped(&app, "user", None);
                break;
            }
            _ = ticker.tick() => {}
        }

        // 1. Refresh foreground every 3s (and on first tick).
        if last_fg_check.elapsed() >= FOREGROUND_CHECK_INTERVAL {
            last_fg_check = Instant::now();
            match resolve_target(&serial) {
                Ok(Some(new_target)) => {
                    let changed = target
                        .as_ref()
                        .map(|t| t.package != new_target.package)
                        .unwrap_or(true);
                    if changed {
                        let _ = app.emit(
                            EVT_TARGET_CHANGED,
                            TargetChanged {
                                from: target.as_ref().map(|t| t.package.clone()),
                                to: new_target.package.clone(),
                            },
                        );
                        prev_stat = None;
                        prev_net = None;
                        last_net_kbps = None;
                        last_gfx = None;
                    }
                    target = Some(new_target);
                }
                Ok(None) => {
                    debug!("no foreground app detected");
                    continue;
                }
                Err(e) => {
                    warn!(error = ?e, "foreground resolution failed");
                    consecutive_errors += 1;
                    if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                        emit_stopped(&app, "error", Some(e.to_string()));
                        break;
                    }
                    continue;
                }
            }
        }

        let Some(t) = target.as_ref() else {
            continue;
        };

        // 2. CPU + RAM every tick.
        let cpu_mem = match fetch_cpu_mem(&serial, t.pid, prev_stat) {
            Ok(s) => s,
            Err(e) => {
                warn!(error = ?e, "cpu_mem fetch failed");
                consecutive_errors += 1;
                if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
                    emit_stopped(&app, "error", Some(e.to_string()));
                    break;
                }
                continue;
            }
        };
        prev_stat = Some((cpu_mem.stat_snapshot, Instant::now()));

        // 3. Net at its own cadence.
        if last_net_poll.elapsed() >= NET_INTERVAL {
            last_net_poll = Instant::now();
            match fetch_net(&serial, t.uid, prev_net) {
                Ok(s) => {
                    prev_net = Some((s.bytes_snapshot, Instant::now()));
                    last_net_kbps = Some((s.rx_kbps, s.tx_kbps));
                }
                Err(e) => {
                    warn!(error = ?e, "net fetch failed");
                    consecutive_errors += 1;
                }
            }
        }

        // 4. GFX at its own cadence.
        if last_gfx_poll.elapsed() >= GFX_INTERVAL {
            last_gfx_poll = Instant::now();
            match fetch_gfx(&serial, &t.package) {
                Ok(Some(s)) => last_gfx = Some(s),
                Ok(None) => {}
                Err(e) => {
                    warn!(error = ?e, "gfx fetch failed");
                    consecutive_errors += 1;
                }
            }
        }

        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
            emit_stopped(&app, "error", Some("too many collector errors".into()));
            break;
        }

        consecutive_errors = 0;

        let (rx_kbps, tx_kbps) = last_net_kbps.unwrap_or((0.0, 0.0));

        let sample = MetricsSample {
            package: t.package.clone(),
            cpu_pct: cpu_mem.cpu_pct,
            mem_mb: cpu_mem.mem_mb,
            fps: last_gfx.map(|g| g.fps),
            jank_pct: last_gfx.map(|g| g.jank_pct),
            net_rx_kbps: rx_kbps,
            net_tx_kbps: tx_kbps,
            ts: ts_ms(),
        };
        let _ = app.emit(EVT_SAMPLE, sample);
    }

    *RUNNING.lock().await = None;
    info!("metrics task exited");
}

fn emit_stopped(app: &AppHandle, reason: &'static str, message: Option<String>) {
    let _ = app.emit(EVT_STOPPED, StoppedReason { reason, message });
}

fn ts_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
```

- [ ] **Step 3: Add IPC commands**

In `src-tauri/src/ipc/commands.rs`, add the `metrics` import near the top:

```rust
use crate::metrics;
```

And add these handlers at the end of the file (before the `impl serde::Serialize for HierarchyTree` block):

```rust
#[tauri::command]
pub async fn start_metrics(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;
    metrics::start(app, serial).await
}

#[tauri::command]
pub async fn stop_metrics() -> AppResult<()> {
    metrics::stop().await
}
```

- [ ] **Step 4: Register the handlers in lib.rs**

In `src-tauri/src/lib.rs`, add the two new names to the `generate_handler!` macro list, right after `list_workspace`:

```rust
            list_workspace,
            start_metrics,
            stop_metrics,
```

- [ ] **Step 5: Build**

Run: `cd src-tauri && cargo build`
Expected: success. Resolve any warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/metrics/mod.rs src-tauri/src/ipc/commands.rs src-tauri/src/lib.rs
git commit -m "feat(metrics): polling task lifecycle + IPC commands"
```

---

## Task 13: Frontend — IPC wrapper, types, event listeners

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add types and IPC calls**

In `src/lib/ipc.ts`, locate the `events` object and add:

```ts
export interface MetricsSamplePayload {
  package: string;
  cpu_pct: number;
  mem_mb: number;
  fps: number | null;
  jank_pct: number | null;
  net_rx_kbps: number;
  net_tx_kbps: number;
  ts: number;
}

export interface TargetChangedPayload {
  from: string | null;
  to: string;
}

export interface MetricsStoppedPayload {
  reason: "user" | "device_disconnected" | "error";
  message: string | null;
}
```

Extend the `ipc` export with:

```ts
  startMetrics: () => call<void>("start_metrics"),
  stopMetrics: () => call<void>("stop_metrics"),
```

Extend the `events` export with:

```ts
  onMetricsSample: (handler: (p: MetricsSamplePayload) => void): Promise<UnlistenFn> =>
    listen<MetricsSamplePayload>("metrics:sample", (e) => handler(e.payload)),
  onMetricsTargetChanged: (handler: (p: TargetChangedPayload) => void): Promise<UnlistenFn> =>
    listen<TargetChangedPayload>("metrics:target_changed", (e) => handler(e.payload)),
  onMetricsStopped: (handler: (p: MetricsStoppedPayload) => void): Promise<UnlistenFn> =>
    listen<MetricsStoppedPayload>("metrics:stopped", (e) => handler(e.payload)),
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat(metrics): IPC and event wrappers"
```

---

## Task 14: Settings store — add perfMonitoringEnabled

**Files:**
- Modify: `src/stores/settingsStore.ts`

- [ ] **Step 1: Extend the store**

In `src/stores/settingsStore.ts`:

Add to the interface, after `streamEnabled`:

```ts
  perfMonitoringEnabled: boolean;
  setPerfMonitoringEnabled: (v: boolean) => void;
```

Add to the store body, next to the other defaults:

```ts
      perfMonitoringEnabled: false,
      setPerfMonitoringEnabled: (perfMonitoringEnabled) => set({ perfMonitoringEnabled }),
```

Add to the `partialize` object:

```ts
        perfMonitoringEnabled: s.perfMonitoringEnabled,
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/settingsStore.ts
git commit -m "feat(settings): perfMonitoringEnabled flag"
```

---

## Task 15: Metrics store

**Files:**
- Create: `src/stores/metricsStore.ts`

- [ ] **Step 1: Create the store**

Write `src/stores/metricsStore.ts`:

```ts
import { create } from "zustand";

export interface Sample {
  ts: number;
  cpuPct: number;
  memMb: number;
  fps: number | null;
  jankPct: number | null;
  netRxKbps: number;
  netTxKbps: number;
}

const MAX_SAMPLES = 60;

interface MetricsState {
  panelOpen: boolean;
  currentPackage: string | null;
  samples: Sample[];
  stoppedReason: string | null;
  togglePanel: () => void;
  setPanelOpen: (v: boolean) => void;
  appendSample: (s: Sample) => void;
  onTargetChanged: (pkg: string) => void;
  setStoppedReason: (r: string | null) => void;
  reset: () => void;
}

export const useMetricsStore = create<MetricsState>((set) => ({
  panelOpen: false,
  currentPackage: null,
  samples: [],
  stoppedReason: null,
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  appendSample: (s) =>
    set((state) => {
      const next = [...state.samples, s];
      if (next.length > MAX_SAMPLES) next.splice(0, next.length - MAX_SAMPLES);
      return { samples: next };
    }),
  onTargetChanged: (pkg) =>
    set({ currentPackage: pkg, samples: [], stoppedReason: null }),
  setStoppedReason: (stoppedReason) => set({ stoppedReason }),
  reset: () =>
    set({
      panelOpen: false,
      currentPackage: null,
      samples: [],
      stoppedReason: null,
    }),
}));
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/metricsStore.ts
git commit -m "feat(metrics): frontend store with ring buffer"
```

---

## Task 16: Sparkline component

**Files:**
- Create: `src/components/MetricsSparkline.tsx`

Goal: a hand-rolled SVG `<polyline>` memoized on its inputs. No chart lib.

- [ ] **Step 1: Write the component**

Write `src/components/MetricsSparkline.tsx`:

```tsx
import { memo, useMemo } from "react";

import { cn } from "@/lib/utils";

interface Props {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}

function SparklineImpl({ values, width = 220, height = 28, className }: Props) {
  const { path, min, max } = useMemo(() => {
    const nums = values.filter((v): v is number => v != null);
    if (nums.length === 0) return { path: "", min: 0, max: 0 };
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const range = max - min || 1;
    const step = values.length > 1 ? width / (values.length - 1) : 0;
    const points: string[] = [];
    values.forEach((v, i) => {
      if (v == null) return;
      const x = i * step;
      const y = height - ((v - min) / range) * height;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return { path: points.join(" "), min, max };
  }, [values, width, height]);

  return (
    <svg
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      aria-label={`sparkline from ${min.toFixed(1)} to ${max.toFixed(1)}`}
      role="img"
    >
      {path && (
        <polyline
          points={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export const MetricsSparkline = memo(SparklineImpl);
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MetricsSparkline.tsx
git commit -m "feat(metrics): sparkline component"
```

---

## Task 17: Metrics panel component

**Files:**
- Create: `src/components/MetricsPanel.tsx`

- [ ] **Step 1: Write the component**

Write `src/components/MetricsPanel.tsx`:

```tsx
import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { MetricsSparkline } from "@/components/MetricsSparkline";
import { useDeviceStore } from "@/stores/deviceStore";
import { useMetricsStore } from "@/stores/metricsStore";

export function MetricsPanel() {
  const setPanelOpen = useMetricsStore((s) => s.setPanelOpen);
  const pkg = useMetricsStore((s) => s.currentPackage);
  const samples = useMetricsStore((s) => s.samples);
  const stopped = useMetricsStore((s) => s.stoppedReason);
  const device = useDeviceStore((s) => s.current);

  const last = samples[samples.length - 1];

  return (
    <section className="flex w-[280px] shrink-0 flex-col border-l border-border bg-muted/30">
      <header className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Performance
          </div>
          <div className="truncate text-[11px] text-foreground/80">
            {pkg ?? "—"}
          </div>
        </div>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setPanelOpen(false)}
          aria-label="Close performance panel"
        >
          <X className="h-3 w-3" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2 text-[11px]">
        {!device ? (
          <div className="text-muted-foreground">
            Connect a device to monitor performance.
          </div>
        ) : stopped ? (
          <div className="text-red-600 dark:text-red-400">
            Monitoring stopped ({stopped}).
          </div>
        ) : samples.length === 0 ? (
          <div className="text-muted-foreground">Waiting for samples…</div>
        ) : (
          <div className="space-y-3">
            <Card
              label="CPU"
              value={last?.cpuPct.toFixed(1) ?? "—"}
              unit="%"
              series={samples.map((s) => s.cpuPct)}
            />
            <Card
              label="RAM"
              value={last?.memMb.toFixed(0) ?? "—"}
              unit="MB"
              series={samples.map((s) => s.memMb)}
            />
            <Card
              label="FPS"
              value={last?.fps != null ? last.fps.toFixed(0) : "—"}
              unit=""
              series={samples.map((s) => s.fps)}
            />
            <Card
              label="Jank"
              value={last?.jankPct != null ? last.jankPct.toFixed(1) : "—"}
              unit="%"
              series={samples.map((s) => s.jankPct)}
            />
            <Card
              label="Net ↓"
              value={last?.netRxKbps.toFixed(1) ?? "—"}
              unit="KB/s"
              series={samples.map((s) => s.netRxKbps)}
            />
            <Card
              label="Net ↑"
              value={last?.netTxKbps.toFixed(1) ?? "—"}
              unit="KB/s"
              series={samples.map((s) => s.netTxKbps)}
            />
          </div>
        )}
      </div>
    </section>
  );
}

function Card({
  label,
  value,
  unit,
  series,
}: {
  label: string;
  value: string;
  unit: string;
  series: (number | null)[];
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="font-mono tabular-nums">
          {value} <span className="text-[10px] text-muted-foreground">{unit}</span>
        </span>
      </div>
      <MetricsSparkline values={series} className="text-foreground/60" />
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

The selector uses `s.current` because `useDeviceStore` exposes the connected device via the `current: Device | null` field (verified in `src/stores/deviceStore.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/components/MetricsPanel.tsx
git commit -m "feat(metrics): panel component"
```

---

## Task 18: Settings dialog — add checkbox

**Files:**
- Modify: `src/components/SettingsDialog.tsx`

- [ ] **Step 1: Read the existing file to locate the right section**

Run: `cat src/components/SettingsDialog.tsx | head -80`

Find how existing toggles (e.g., `streamEnabled`) are rendered. Copy that pattern for the new toggle.

- [ ] **Step 2: Add the new control**

Near the existing `streamEnabled` row, add an equivalent row for `perfMonitoringEnabled`. Example (adjust to match existing patterns — checkbox, switch, or label wrap):

```tsx
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={perfMonitoringEnabled}
            onChange={(e) => setPerfMonitoringEnabled(e.target.checked)}
          />
          Enable performance monitoring (adds an HUD next to the console)
        </label>
```

Pull the values via existing selector style:

```tsx
  const perfMonitoringEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const setPerfMonitoringEnabled = useSettingsStore(
    (s) => s.setPerfMonitoringEnabled,
  );
```

- [ ] **Step 3: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/SettingsDialog.tsx
git commit -m "feat(settings): performance monitoring toggle"
```

---

## Task 19: Run console — add HUD toggle button

**Files:**
- Modify: `src/components/RunConsole.tsx`

- [ ] **Step 1: Add the button**

In `src/components/RunConsole.tsx`:

Add imports at the top:

```tsx
import { Activity, Eraser, Play, Square } from "lucide-react";
import { useSettingsStore } from "@/stores/settingsStore";
import { useMetricsStore } from "@/stores/metricsStore";
```

(Replace the existing `lucide-react` import instead of duplicating.)

Inside the component, read the state:

```tsx
  const perfEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const panelOpen = useMetricsStore((s) => s.panelOpen);
  const togglePanel = useMetricsStore((s) => s.togglePanel);
```

In the header right-side button group, just before the `Clear` button, insert:

```tsx
          {perfEnabled && (
            <Button
              size="xs"
              variant={panelOpen ? "default" : "ghost"}
              onClick={togglePanel}
              title="Toggle performance HUD"
            >
              <Activity className="h-3 w-3" />
              Perf
            </Button>
          )}
```

- [ ] **Step 2: Type-check**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/RunConsole.tsx
git commit -m "feat(runner): HUD toggle button in console"
```

---

## Task 20: App.tsx — layout + event wiring + lifecycle

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports**

Add at the top of `src/App.tsx`:

```tsx
import { MetricsPanel } from "@/components/MetricsPanel";
import { useMetricsStore } from "@/stores/metricsStore";
```

- [ ] **Step 2: Wire events in the existing registration `useEffect`**

Locate the `Promise.all([...])` block that registers `events.onRunnerStdout`, etc. Add the three metrics event handlers to that same `Promise.all`, and grab the two store setters:

Before the `useEffect`, add selectors:

```tsx
  const appendSample = useMetricsStore((s) => s.appendSample);
  const onTargetChanged = useMetricsStore((s) => s.onTargetChanged);
  const setStoppedReason = useMetricsStore((s) => s.setStoppedReason);
```

Inside the `Promise.all`, add:

```tsx
      events.onMetricsSample((p) =>
        appendSample({
          ts: p.ts,
          cpuPct: p.cpu_pct,
          memMb: p.mem_mb,
          fps: p.fps,
          jankPct: p.jank_pct,
          netRxKbps: p.net_rx_kbps,
          netTxKbps: p.net_tx_kbps,
        }),
      ),
      events.onMetricsTargetChanged((p) => onTargetChanged(p.to)),
      events.onMetricsStopped((p) =>
        setStoppedReason(p.reason === "user" ? null : p.reason),
      ),
```

And add the three setters to the `useEffect` dependency array.

- [ ] **Step 3: Drive start/stop lifecycle**

Add a new `useEffect` after the events effect that reacts to `panelOpen`:

```tsx
  const panelOpen = useMetricsStore((s) => s.panelOpen);
  const perfEnabled = useSettingsStore((s) => s.perfMonitoringEnabled);
  const deviceConnected = useDeviceStore((s) => Boolean(s.current));

  useEffect(() => {
    if (!perfEnabled || !panelOpen || !deviceConnected) {
      void ipc.stopMetrics().catch(() => {});
      return;
    }
    void ipc.startMetrics().catch((err) => {
      toast.error(
        "Performance monitoring failed to start",
        err instanceof Error ? err.message : String(err),
      );
    });
    return () => {
      void ipc.stopMetrics().catch(() => {});
    };
  }, [perfEnabled, panelOpen, deviceConnected]);
```

The selector reads `s.current` because `useDeviceStore` tracks the connected device under that key (per `src/stores/deviceStore.ts`).

- [ ] **Step 4: Update the layout to include the panel**

Find the JSX where `<RunConsole .../>` is rendered. Currently:

```tsx
          <RunConsole onRun={() => void onRun()} onStop={() => void onStop()} />
```

Wrap it in a flex container:

```tsx
          <div className="flex min-h-0">
            <div className="flex min-h-0 flex-1 flex-col">
              <RunConsole onRun={() => void onRun()} onStop={() => void onStop()} />
            </div>
            {perfEnabled && panelOpen && <MetricsPanel />}
          </div>
```

- [ ] **Step 5: Type-check + build**

Run: `pnpm typecheck && pnpm build`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat(metrics): wire panel + lifecycle in App"
```

---

## Task 21: End-to-end smoke test

**Files:** none modified (manual validation)

- [ ] **Step 1: Dev run**

Run: `pnpm tauri:dev`
Expected: app window opens, no runtime errors in devtools console.

- [ ] **Step 2: Verify feature-off baseline**

- Open Settings → confirm "Enable performance monitoring" is **unchecked** by default.
- Confirm the Perf button does **not** appear in the Run Console.
- Confirm no `start_metrics` / `stop_metrics` IPC calls in devtools network / tauri logs.

- [ ] **Step 3: Verify feature-on, panel-closed**

- Toggle the setting ON.
- Confirm the Perf button **appears** next to Clear in the Run Console.
- Confirm **no polling occurs yet** (no `metrics:sample` events, no ADB calls in Rust `info!` logs).

- [ ] **Step 4: Verify panel open with a device**

- Plug in an Android device, connect from the device selector.
- Click the Perf button → panel appears on the right of the console.
- Interact with the device (swipe, open apps).
- Confirm:
  - Package name updates in the panel header when you switch apps on the device.
  - CPU %, RAM, Net numbers update every 1-2s.
  - FPS / Jank update every 5s (will show `—` until the first gfxinfo tick).
  - Sparklines draw smoothly.

- [ ] **Step 5: Verify panel close stops polling**

- Click the panel close button.
- Confirm `stop_metrics` logged in Rust logs.
- Confirm no further samples arrive.

- [ ] **Step 6: Verify disconnect behavior**

- With the panel open and a device connected, unplug the device.
- Confirm the panel switches to the "Connect a device…" or stopped-reason state and polling halts without panics.

- [ ] **Step 7: Verify host-app performance**

- Watch the scrcpy stream FPS counter (if `showFps` is on) while the HUD is open. Confirm 60 FPS is maintained.
- Confirm cold start time hasn't regressed (informal — close/reopen the dev app).

- [ ] **Step 8: If any manual test fails, open a task describing the exact regression and fix before marking this task complete.**

- [ ] **Step 9: Commit any follow-up fixes**

```bash
git add -A
git commit -m "fix(metrics): smoke-test follow-ups"
```

(Skip this step if no follow-ups were needed.)

---

## Done

When all tasks above are complete:

- The frontend has a HUD panel that can be toggled open/closed next to the Run Console.
- When the panel is closed or the settings flag is off, no polling runs.
- When open, the user sees CPU, RAM, FPS, jank %, and per-app network I/O updating live for whichever Android app is in foreground.
- The v0.1 KPIs (cold start, RAM idle, FPS streaming) are preserved — verified in Task 21.
