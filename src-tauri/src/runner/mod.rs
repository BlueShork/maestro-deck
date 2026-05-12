//! Maestro runner subprocess orchestration.

use std::collections::HashMap;
use std::process::Stdio;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{oneshot, Mutex as AsyncMutex};
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::process_ext::CommandExtNoWindow;

const EVT_STDOUT: &str = "runner:stdout";
const EVT_STDERR: &str = "runner:stderr";
const EVT_EXIT: &str = "runner:exit";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerEvent {
    pub stream: String,
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerExit {
    pub pid: u32,
    pub code: Option<i32>,
}

/// Map of active runner PIDs to their kill-signal sender. The kill signal is
/// consumed by the wait task which owns the `Child` and calls `kill().await`
/// from a `tokio::select!` arm. Entries are removed once the wait task
/// completes (whether the runner exited on its own or was killed).
static RUNNERS: Lazy<AsyncMutex<HashMap<u32, oneshot::Sender<()>>>> =
    Lazy::new(|| AsyncMutex::new(HashMap::new()));

/// Resolves to the user's `maestro` install — see `crate::tool_paths` for
/// the full priority chain (user override → env → common paths → shell).
fn maestro_bin() -> String {
    crate::tool_paths::maestro_bin()
}

/// Spawn `maestro --udid <serial> test <flow>` and stream stdout/stderr to
/// the frontend via Tauri events. The PID is returned so the frontend can
/// request a stop.
///
/// `--udid` (not `--device`) is the right flag for a specific physical
/// device serial: in maestro 2.5.x, `--device` was repurposed to mean a
/// device *model* (e.g. `pixel_6`) and silently rejects serials with
/// "Device <serial> was requested, but it is not connected."
pub async fn spawn_runner(
    app: AppHandle,
    serial: &str,
    flow_path: &str,
    on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>,
) -> AppResult<u32> {
    let bin = maestro_bin();
    info!(bin = %bin, serial, flow = %flow_path, "spawning maestro");

    // Maestro 2.5.x's session manager calls `dadb.Dadb.list()` which
    // walks every adb-server transport before honoring `--udid` — any
    // offline entry (typically `emulator-5554` ghosts created by adb's
    // periodic emulator-port auto-scan) causes enumeration to fail
    // with `Command failed (...): device offline`, and the test exits
    // with "Device <serial> not connected" even though the intended
    // device is plugged in.
    //
    // Loop disconnect until no offline emulator transport is left or
    // we've spent ~2s trying. adb's auto-scan cycle is also ~2s so
    // racing against a fresh ghost is rare but possible — in practice
    // the user can just click Run again.
    let adb = crate::device::adb::adb_bin();
    for _ in 0..10 {
        let devs = tokio::process::Command::new(&adb)
            .no_window()
            .args(["devices"])
            .output()
            .await;
        let has_offline_emulator = match devs {
            Ok(out) => {
                let stdout = String::from_utf8_lossy(&out.stdout);
                stdout
                    .lines()
                    .any(|l| l.contains("emulator-") && l.contains("offline"))
            }
            Err(_) => false,
        };
        if !has_offline_emulator {
            break;
        }
        for emulator in ["emulator-5554", "emulator-5556", "emulator-5558"] {
            let _ = tokio::process::Command::new(&adb)
                .no_window()
                .args(["disconnect", emulator])
                .output()
                .await;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    let mut child = Command::new(&bin)
        .no_window()
        .args(["--udid", serial, "test"])
        .arg(flow_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

    let pid = child.id().ok_or_else(|| {
        AppError::RunnerFailed("spawned child had no PID (already exited)".into())
    })?;

    if let Some(stdout) = child.stdout.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stdout", "{line}");
                let _ = app.emit(EVT_STDOUT, &line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app = app.clone();
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stderr", "{line}");
                let _ = app.emit(EVT_STDERR, &line);
            }
        });
    }

    // Register the kill channel BEFORE spawning the wait task so a quick
    // `stop_flow` after `run_flow` returns can always find the PID.
    let (kill_tx, kill_rx) = oneshot::channel::<()>();
    RUNNERS.lock().await.insert(pid, kill_tx);

    let app_exit = app.clone();
    let on_exit_hook = on_exit;
    tokio::spawn(async move {
        let code = tokio::select! {
            status = child.wait() => status.ok().and_then(|s| s.code()),
            _ = kill_rx => {
                if let Err(e) = child.kill().await {
                    warn!(pid, error = %e, "child kill failed");
                }
                child.wait().await.ok().and_then(|s| s.code())
            }
        };
        RUNNERS.lock().await.remove(&pid);
        // Fire the optional post-exit hook BEFORE emitting the exit event.
        // The hook may schedule background work (e.g. studio restart) that
        // we want kicked off as early as possible — the frontend doesn't
        // need to wait for it, since the hook just spawns and returns.
        if let Some(hook) = on_exit_hook {
            hook(app_exit.clone());
        }
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });

    Ok(pid)
}

pub async fn kill_runner(pid: u32) -> AppResult<()> {
    let tx = RUNNERS.lock().await.remove(&pid);
    match tx {
        Some(tx) => {
            // The receiver may already be dropped if the runner exited in the
            // tiny window between us locking and the wait task finishing —
            // that's fine, send returns Err which we ignore.
            let _ = tx.send(());
            Ok(())
        }
        None => Err(AppError::RunnerFailed(format!("no runner with PID {pid}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn kill_unknown_pid_errors() {
        let res = kill_runner(987_654_321).await;
        assert!(matches!(res, Err(AppError::RunnerFailed(_))));
    }
}
