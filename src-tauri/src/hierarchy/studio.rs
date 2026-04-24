//! Keep a background `maestro studio` process alive so the on-device
//! driver stays installed and its gRPC server stays bound to
//! `localhost:7001`. Studio does the heavy lifting (install driver APK
//! + start instrumentation + set up adb forward); we piggyback on it
//! to avoid reimplementing that flow ourselves.
//!
//! Once `start()` returns, callers can connect a tonic client to
//! `http://127.0.0.1:7001` and issue `MaestroDriver` RPCs directly —
//! bypassing the slow one-shot `maestro hierarchy` CLI path entirely.
//!
//! Lifecycle: the returned `StudioKeeper` owns the child process.
//! `stop()` is the preferred graceful shutdown; dropping the keeper
//! falls back to `kill_on_drop(true)` (SIGKILL) to guarantee the
//! subprocess never outlives the app.

use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::net::TcpStream;
use tokio::process::{Child, Command};
use tokio::sync::Mutex;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};

/// The gRPC port the on-device Maestro driver binds to. The Maestro
/// CLI hardcodes this in `DefaultDriverHostPort` and sets up an adb
/// forward from `localhost:7001` to the same port on-device.
pub const DRIVER_PORT: u16 = 7001;

/// How long we wait for `maestro studio` to install the driver APK,
/// start instrumentation, and open the forwarded port. Cold start is
/// dominated by JVM spin-up (~3 s) + APK install (~5-8 s); 30 s gives
/// a comfortable margin on slow machines.
const STUDIO_READY_TIMEOUT: Duration = Duration::from_secs(30);
/// Poll interval while probing the forwarded port.
const READY_POLL_INTERVAL: Duration = Duration::from_millis(250);

pub struct StudioKeeper {
    child: Mutex<Option<Child>>,
    serial: String,
}

impl StudioKeeper {
    /// Spawn `maestro --device <serial> studio` and wait until the
    /// gRPC driver is reachable on `localhost:7001`. Returns as soon
    /// as a TCP connection to the port succeeds — the caller can
    /// immediately issue RPCs against it.
    pub async fn start(serial: &str) -> AppResult<Self> {
        let bin = super::maestro_bin();
        info!(
            serial,
            bin,
            port = DRIVER_PORT,
            "spawning maestro studio to keep driver warm"
        );

        let mut cmd = Command::new(&bin);
        // `--no-window` tells studio to skip opening a browser tab on
        // start; we only need the side-effect (driver installed +
        // gRPC port forwarded), not the web UI.
        cmd.args(["--device", serial, "studio", "--no-window"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);

        let child = cmd.spawn().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::RunnerNotFound
            } else {
                AppError::Io(e)
            }
        })?;

        let keeper = Self {
            child: Mutex::new(Some(child)),
            serial: serial.to_string(),
        };

        keeper.await_ready().await?;
        Ok(keeper)
    }

    /// Poll `localhost:7001` until it accepts connections (driver up
    /// and adb forward in place) or we time out. Also bails early if
    /// the studio process itself exits — no point polling a port that
    /// will never open.
    async fn await_ready(&self) -> AppResult<()> {
        let deadline = Instant::now() + STUDIO_READY_TIMEOUT;
        let addr = ("127.0.0.1", DRIVER_PORT);
        let start = Instant::now();

        loop {
            if Instant::now() >= deadline {
                return Err(AppError::RunnerFailed(format!(
                    "maestro studio did not open port {DRIVER_PORT} within {:?}",
                    STUDIO_READY_TIMEOUT
                )));
            }

            // Surface studio's own failure faster than waiting for the
            // overall timeout — if the child has already exited, the
            // port is never coming up.
            if let Some(child) = self.child.lock().await.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    warn!(
                        ?status,
                        "maestro studio exited before binding {}",
                        DRIVER_PORT
                    );
                    return Err(AppError::RunnerFailed(format!(
                        "maestro studio exited before port {DRIVER_PORT} was ready (status: {status})"
                    )));
                }
            }

            if TcpStream::connect(addr).await.is_ok() {
                info!(
                    elapsed_ms = start.elapsed().as_millis(),
                    "maestro studio ready — driver listening on {}",
                    DRIVER_PORT
                );
                return Ok(());
            }

            tokio::time::sleep(READY_POLL_INTERVAL).await;
        }
    }

    /// Graceful shutdown: kill the child and reap it. Safe to call
    /// multiple times (idempotent).
    pub async fn stop(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            debug!(serial = %self.serial, "stopping maestro studio");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    pub fn serial(&self) -> &str {
        &self.serial
    }
}

// Tokio's `Child` was spawned with `kill_on_drop(true)`, so when a
// `StudioKeeper` is dropped the runtime will SIGKILL the subprocess
// automatically — no explicit Drop impl needed here.
