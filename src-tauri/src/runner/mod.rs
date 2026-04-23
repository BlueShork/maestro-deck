//! Maestro runner subprocess orchestration.

use std::process::Stdio;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};

const DEFAULT_BIN: &str = "maestro";

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
static CHILDREN: Lazy<Mutex<Vec<(u32, tokio::process::Child)>>> =
    Lazy::new(|| Mutex::new(Vec::new()));

fn maestro_bin() -> String {
    std::env::var("MAESTRO_BIN").unwrap_or_else(|_| DEFAULT_BIN.to_string())
}

/// Spawn `maestro test <flow>` and stream stdout/stderr via tracing. The PID
/// is returned so the frontend can request a stop.
pub fn spawn_runner(flow_path: &str) -> AppResult<u32> {
    let bin = maestro_bin();
    info!(bin = %bin, flow = %flow_path, "spawning maestro");

    let mut cmd = Command::new(&bin);
    cmd.arg("test")
        .arg(flow_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd.spawn().map_err(|e| {
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
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stdout", "{}", line);
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let mut reader = BufReader::new(stderr).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                debug!(target: "maestro::stderr", "{}", line);
            }
        });
    }

    if let Ok(mut guard) = CHILDREN.lock() {
        guard.push((pid, child));
    } else {
        warn!("failed to register child process");
    }

    Ok(pid)
}

pub fn kill_runner(pid: u32) -> AppResult<()> {
    let mut guard = CHILDREN
        .lock()
        .map_err(|_| AppError::Other("runner registry poisoned".into()))?;
    if let Some(idx) = guard.iter().position(|(p, _)| *p == pid) {
        let (_, mut child) = guard.swap_remove(idx);
        // start_kill is sync and only signals; reaping happens when the spawned
        // tasks reading stdout/stderr observe EOF.
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
    async fn spawn_returns_runner_not_found_when_missing() {
        std::env::set_var("MAESTRO_BIN", "this-binary-definitely-does-not-exist-xyz");
        let res = spawn_runner("/tmp/nope.yaml");
        std::env::remove_var("MAESTRO_BIN");
        assert!(matches!(res, Err(AppError::RunnerNotFound)));
    }

    #[tokio::test]
    async fn kill_unknown_pid_errors() {
        let res = kill_runner(987_654_321);
        assert!(matches!(res, Err(AppError::RunnerFailed(_))));
    }
}
