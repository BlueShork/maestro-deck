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
