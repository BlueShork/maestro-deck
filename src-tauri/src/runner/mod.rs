//! Maestro runner subprocess orchestration. Stub — agent fills in (plan §4 Phase 6).
use crate::error::AppResult;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerEvent {
    pub stream: String,
    pub line: String,
}

pub fn spawn_runner(_flow_path: &str) -> AppResult<u32> {
    Ok(0)
}

pub fn kill_runner(_pid: u32) -> AppResult<()> {
    Ok(())
}
