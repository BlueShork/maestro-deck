//! ADB device discovery and shell command execution.
//!
//! Filled in by the backend agent — see plan §4 Phase 1.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Device {
    pub serial: String,
    pub model: String,
    pub android_version: String,
    pub screen_width: u32,
    pub screen_height: u32,
}

pub mod adb;
