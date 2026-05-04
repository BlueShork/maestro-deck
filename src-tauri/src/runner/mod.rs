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

const DEFAULT_BIN: &str = "maestro";
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

fn maestro_bin() -> String {
    std::env::var("MAESTRO_BIN").unwrap_or_else(|_| DEFAULT_BIN.to_string())
}

/// Spawn `maestro test <flow>` and stream stdout/stderr to the frontend via
/// Tauri events. The PID is returned so the frontend can request a stop.
pub async fn spawn_runner(
    app: AppHandle,
    flow_path: &str,
    on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>>,
) -> AppResult<u32> {
    let bin = maestro_bin();
    info!(bin = %bin, flow = %flow_path, "spawning maestro");

    let mut child = Command::new(&bin)
        .arg("test")
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
