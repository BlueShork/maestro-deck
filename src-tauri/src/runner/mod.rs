//! Maestro runner subprocess orchestration.

use std::process::Stdio;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;
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

/// Track spawned children by PID so `stop_flow` can target the right process.
/// Uses tokio::sync::Mutex so we can `await` on `start_kill` if needed and
/// avoid blocking the async runtime.
static CHILDREN: Lazy<AsyncMutex<Vec<(u32, tokio::process::Child)>>> =
    Lazy::new(|| AsyncMutex::new(Vec::new()));

fn maestro_bin() -> String {
    std::env::var("MAESTRO_BIN").unwrap_or_else(|_| DEFAULT_BIN.to_string())
}

/// Spawn `maestro test <flow>` and stream stdout/stderr to the frontend via
/// Tauri events. The PID is returned so the frontend can request a stop.
pub async fn spawn_runner(app: AppHandle, flow_path: &str) -> AppResult<u32> {
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

    // Wait for exit in a separate task so spawn_runner returns immediately.
    let app_exit = app.clone();
    tokio::spawn(async move {
        let code = match wait_and_remove(pid).await {
            Ok(c) => c,
            Err(e) => {
                warn!(error = %e, "runner wait failed");
                None
            }
        };
        let _ = app_exit.emit(EVT_EXIT, RunnerExit { pid, code });
    });

    CHILDREN.lock().await.push((pid, child));
    Ok(pid)
}

async fn wait_and_remove(pid: u32) -> AppResult<Option<i32>> {
    let mut child = {
        let mut guard = CHILDREN.lock().await;
        let idx = guard
            .iter()
            .position(|(p, _)| *p == pid)
            .ok_or_else(|| AppError::RunnerFailed(format!("pid {pid} not registered")))?;
        guard.swap_remove(idx).1
    };
    let status = child
        .wait()
        .await
        .map_err(|e| AppError::RunnerFailed(format!("wait failed: {e}")))?;
    Ok(status.code())
}

pub async fn kill_runner(pid: u32) -> AppResult<()> {
    let mut guard = CHILDREN.lock().await;
    if let Some(idx) = guard.iter().position(|(p, _)| *p == pid) {
        let (_, child) = guard.get_mut(idx).expect("just located");
        child
            .start_kill()
            .map_err(|e| AppError::RunnerFailed(format!("kill failed: {e}")))?;
        Ok(())
    } else {
        Err(AppError::RunnerFailed(format!("no runner with PID {pid}")))
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
