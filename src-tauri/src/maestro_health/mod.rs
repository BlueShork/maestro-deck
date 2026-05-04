//! Detect and remove leftover Maestro driver, port forwarding, and
//! instrumentation residue on a connected Android device.
//!
//! Two entry points:
//! - [`detect::check_device_health`] — read-only.
//! - [`kill::kill_maestro_processes`] — destructive, bounded by a
//!   `HealthReport` provided by the caller and guarded by hardcoded
//!   whitelists.

pub mod detect;
pub mod kill;

use serde::{Deserialize, Serialize};

/// The Maestro driver Android package. The ONLY package eligible for
/// `am force-stop`. Hardcoded — never read from user input.
pub const MAESTRO_DRIVER_PACKAGE: &str = "dev.mobile.maestro";

/// The standard Maestro driver port. The ONLY port eligible for
/// `adb forward --remove`.
pub const MAESTRO_DRIVER_PORT: u16 = 7001;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthReport {
    pub device_id: String,
    pub driver_running: Option<u32>,
    pub port_forwarded: Option<String>,
    pub orphan_processes: Vec<ProcessInfo>,
    pub adb_available: bool,
}

impl HealthReport {
    pub fn is_clean(&self) -> bool {
        self.driver_running.is_none()
            && self.port_forwarded.is_none()
            && self.orphan_processes.is_empty()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KillReport {
    pub driver_killed: bool,
    pub port_unforwarded: bool,
    pub orphans_killed: Vec<u32>,
    pub orphans_skipped: Vec<(u32, String)>,
    pub errors: Vec<String>,
}
