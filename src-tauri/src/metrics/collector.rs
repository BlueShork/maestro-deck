// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! ADB call orchestration + delta computation. No timing here — the task
//! loop calls these functions on its own cadence.

use std::time::Instant;

use crate::device::adb;
use crate::error::{AppError, AppResult};
use crate::metrics::parsers::{
    cpu_percent, parse_gfxinfo, parse_netstats_detail_for_uid, parse_proc_stat,
    parse_thermal_status, parse_vm_rss_mb, parse_xt_qtaguid_for_uid, NetBytes, ProcStat,
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
    pub p50_ms: Option<f32>,
    pub p90_ms: Option<f32>,
    pub p95_ms: Option<f32>,
    pub p99_ms: Option<f32>,
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
            cpu_percent(prev_stat, stat, elapsed, ANDROID_USER_HZ)
        }
        None => 0.0,
    };

    Ok(CpuMemSample {
        cpu_pct,
        mem_mb,
        stat_snapshot: stat,
    })
}

pub fn fetch_net(
    serial: &str,
    uid: u32,
    prev: Option<(NetBytes, Instant)>,
) -> AppResult<NetSample> {
    // Try xt_qtaguid first. Fall back to `dumpsys netstats detail` if the
    // file is unreadable (Android 12+) or if it is readable but contains no
    // rows for this UID (e.g. counters disabled).
    let bytes_opt: Option<NetBytes> = match adb::exec_shell(
        serial,
        "cat /proc/net/xt_qtaguid/stats",
    ) {
        Ok(stats) => {
            let parsed = parse_xt_qtaguid_for_uid(&stats, uid);
            if parsed.is_none() {
                tracing::debug!(uid, "xt_qtaguid readable but no matching rows for uid");
            }
            parsed
        }
        Err(e) => {
            tracing::debug!(uid, error = ?e, "xt_qtaguid unreadable; falling back to dumpsys netstats");
            None
        }
    };
    let bytes = match bytes_opt {
        Some(b) => b,
        None => {
            let dump = adb::exec_shell(serial, "dumpsys netstats detail")?;
            match parse_netstats_detail_for_uid(&dump, uid) {
                Some(b) => b,
                None => {
                    // Extract a short diagnostic snippet around the UID so we can
                    // see what format the device is using without asking the user.
                    let needle = format!("{uid}");
                    let snippet: String = dump
                        .find(&needle)
                        .map(|pos| {
                            let start = pos.saturating_sub(60);
                            let end = (pos + 200).min(dump.len());
                            dump[start..end]
                                .replace('\n', " | ")
                                .chars()
                                .take(260)
                                .collect()
                        })
                        .unwrap_or_else(|| "<uid not found in dump at all>".into());
                    tracing::warn!(
                        uid,
                        dump_len = dump.len(),
                        snippet = %snippet,
                        "dumpsys netstats detail did not contain rows for uid — net will report 0"
                    );
                    NetBytes { rx: 0, tx: 0 }
                }
            }
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

    Ok(NetSample {
        rx_kbps,
        tx_kbps,
        bytes_snapshot: bytes,
    })
}

pub fn fetch_gfx(serial: &str, package: &str) -> AppResult<Option<GfxSample>> {
    let cmd = format!("dumpsys gfxinfo {package} framestats");
    let out = adb::exec_shell(serial, &cmd)?;
    // Reset counters so the next 5s window is independent.
    if let Err(e) = adb::exec_shell(serial, &format!("dumpsys gfxinfo {package} reset")) {
        tracing::warn!(error = ?e, "gfxinfo reset failed; fps will inflate over time");
    }

    let Some(stats) = parse_gfxinfo(&out) else {
        return Ok(None);
    };
    if stats.total_frames == 0 {
        return Ok(None);
    }
    // Window is 5s — FPS is total/5.
    let fps = stats.total_frames as f32 / 5.0;
    let jank_pct = stats.janky_frames as f32 * 100.0 / stats.total_frames as f32;
    Ok(Some(GfxSample {
        fps,
        jank_pct,
        p50_ms: stats.p50_ms,
        p90_ms: stats.p90_ms,
        p95_ms: stats.p95_ms,
        p99_ms: stats.p99_ms,
    }))
}

pub fn fetch_thermal(serial: &str) -> AppResult<Option<u8>> {
    let out = adb::exec_shell(serial, "dumpsys thermalservice")?;
    Ok(parse_thermal_status(&out))
}

#[cfg(test)]
mod tests {
    #[test]
    fn split_separator_works_on_joined_output() {
        // Sanity-check the batched-output separator logic without a real device.
        let joined = "stat line here\n---\nstatus content here\n";
        let (a, b) = joined.split_once("\n---\n").expect("should split");
        assert_eq!(a, "stat line here");
        assert!(b.contains("status"));
    }

    #[test]
    fn split_separator_returns_none_without_marker() {
        assert!("some stat output with no separator"
            .split_once("\n---\n")
            .is_none());
    }
}
