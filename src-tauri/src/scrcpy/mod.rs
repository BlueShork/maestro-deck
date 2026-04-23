//! scrcpy server orchestration. Stub — agent fills in (plan §4 Phase 2).
use crate::error::AppResult;

pub const SCRCPY_VERSION: &str = "2.7";
pub const DEFAULT_PORT: u16 = 27183;

pub fn push_server(_serial: &str) -> AppResult<()> {
    Ok(())
}

pub fn start_server(_serial: &str) -> AppResult<()> {
    Ok(())
}
