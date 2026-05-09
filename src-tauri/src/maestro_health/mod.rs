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

use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
struct DriverRecoveringPayload<'a> {
    device_id: &'a str,
    action: &'a str,
}

#[derive(Debug, Clone, Serialize)]
struct DriverRecoveredPayload<'a> {
    device_id: &'a str,
}

/// Pre-flight check before any operation that depends on the Maestro
/// gRPC driver. If the driver port responds within `PING_TIMEOUT_MS`,
/// returns immediately. Otherwise emits `driver-recovering`, runs the
/// recovery (kill driver + remove forward), and emits `driver-recovered`.
///
/// `action` is an opaque tag (e.g. "run_flow", "inspect") forwarded in
/// the event payload so the frontend can phrase the toast appropriately
/// or distinguish concurrent flows.
///
/// Never returns an error: recovery failure is non-fatal — the caller
/// proceeds and lets the underlying maestro CLI surface its own error
/// if the device is genuinely unusable.
pub fn preflight_with_recovery(app: &AppHandle, device_id: &str, action: &'static str) {
    const PING_TIMEOUT_MS: u64 = 2_000;

    if detect::ping_driver(PING_TIMEOUT_MS) {
        return;
    }

    tracing::info!(device = %device_id, action, "driver ping failed — recovering");

    let _ = app.emit(
        "driver-recovering",
        DriverRecoveringPayload { device_id, action },
    );

    kill::recover_driver(device_id);

    let _ = app.emit("driver-recovered", DriverRecoveredPayload { device_id });
}
