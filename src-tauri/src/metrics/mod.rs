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
use crate::metrics::collector::{fetch_cpu_mem, fetch_gfx, GfxSample};
use crate::metrics::foreground::{resolve_target, Target};
use crate::metrics::parsers::ProcStat;

const EVT_SAMPLE: &str = "metrics:sample";
const EVT_TARGET_CHANGED: &str = "metrics:target_changed";
const EVT_STOPPED: &str = "metrics:stopped";

const TICK_INTERVAL: Duration = Duration::from_secs(1);
const GFX_INTERVAL: Duration = Duration::from_secs(5);
const FOREGROUND_CHECK_INTERVAL: Duration = Duration::from_secs(3);
const MAX_CONSECUTIVE_ERRORS: u32 = 3;

type MetricsSlot = Option<(oneshot::Sender<()>, tokio::task::JoinHandle<()>)>;

static RUNNING: Lazy<AsyncMutex<MetricsSlot>> = Lazy::new(|| AsyncMutex::new(None));

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
    let join = tokio::spawn(run_loop(app, serial, rx));
    *guard = Some((tx, join));
    info!("metrics task started");
    Ok(())
}

pub async fn stop() -> AppResult<()> {
    let slot = RUNNING.lock().await.take();
    if let Some((tx, join)) = slot {
        let _ = tx.send(());
        info!("metrics task stop requested");
        // Wait for the task to actually exit so a subsequent start() cannot
        // race with a still-alive predecessor. Errors from the join are
        // ignored: if the task panicked, we've already cleared the slot.
        let _ = join.await;
    }
    Ok(())
}

async fn run_loop(app: AppHandle, serial: String, mut cancel: oneshot::Receiver<()>) {
    let mut target: Option<Target> = None;
    let mut prev_stat: Option<(ProcStat, Instant)> = None;
    let mut last_gfx: Option<GfxSample> = None;
    let mut last_fg_check = Instant::now() - FOREGROUND_CHECK_INTERVAL;
    let mut last_gfx_poll = Instant::now() - GFX_INTERVAL;
    let mut consecutive_errors: u32 = 0;
    let mut ticker = tokio::time::interval(TICK_INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

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
            let serial_clone = serial.clone();
            let target_result = tokio::task::spawn_blocking(move || resolve_target(&serial_clone))
                .await
                .unwrap_or_else(|e| {
                    Err(AppError::MetricsFailed(format!(
                        "resolve_target join failed: {e}"
                    )))
                });
            match target_result {
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
        let serial_clone = serial.clone();
        let pid = t.pid;
        let prev = prev_stat;
        let cpu_mem =
            match tokio::task::spawn_blocking(move || fetch_cpu_mem(&serial_clone, pid, prev))
                .await
                .unwrap_or_else(|e| {
                    Err(AppError::MetricsFailed(format!("cpu_mem join failed: {e}")))
                }) {
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

        // 3. Net polling is currently disabled — the dumpsys netstats fallback
        //    doesn't produce reliable per-UID data on Samsung Android 15, and
        //    xt_qtaguid is no longer available there. The UI hides Net ↓/↑ for
        //    now; samples ship with 0 for both. Re-enable once we find a
        //    working source across target Android versions.

        // 4. GFX at its own cadence.
        if last_gfx_poll.elapsed() >= GFX_INTERVAL {
            last_gfx_poll = Instant::now();
            let serial_clone = serial.clone();
            let package = t.package.clone();
            match tokio::task::spawn_blocking(move || fetch_gfx(&serial_clone, &package))
                .await
                .unwrap_or_else(|e| Err(AppError::MetricsFailed(format!("gfx join failed: {e}"))))
            {
                Ok(Some(s)) => last_gfx = Some(s),
                Ok(None) => {}
                Err(e) => {
                    warn!(error = ?e, "gfx fetch failed");
                }
            }
        }

        if consecutive_errors >= MAX_CONSECUTIVE_ERRORS {
            emit_stopped(&app, "error", Some("too many collector errors".into()));
            break;
        }

        consecutive_errors = 0;

        let sample = MetricsSample {
            package: t.package.clone(),
            cpu_pct: cpu_mem.cpu_pct,
            mem_mb: cpu_mem.mem_mb,
            fps: last_gfx.map(|g| g.fps),
            jank_pct: last_gfx.map(|g| g.jank_pct),
            net_rx_kbps: 0.0,
            net_tx_kbps: 0.0,
            ts: ts_ms(),
        };
        let _ = app.emit(EVT_SAMPLE, sample);
    }

    info!("metrics task exited");
    // Self-clear the RUNNING slot when the task exits without an explicit
    // stop() — e.g. on error bailout. We spawn this because we cannot await
    // the mutex from inside the task's own body without risking reentrancy
    // if stop() is concurrently holding the lock.
    tokio::spawn(async {
        let mut guard = RUNNING.lock().await;
        // If stop() already took the slot (normal shutdown), nothing to do.
        // Otherwise clear so a new start() can proceed.
        *guard = None;
    });
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
