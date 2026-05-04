//! Keep a background `maestro studio` process alive so the on-device
//! driver stays installed and its gRPC server stays bound to
//! `localhost:7001`. Studio does the heavy lifting (install driver APK,
//! start instrumentation, set up adb forward); we piggyback on it
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
        // If a previous maestro-deck session was SIGKILLed or crashed,
        // `kill_on_drop` never fires and the studio child outlives the
        // app. On next launch, `await_ready` would connect instantly to
        // that orphan's port 7001, but its on-device driver state is
        // stale and returns an empty `<hierarchy/>` blob — the user
        // sees "Empty hierarchy" forever. Detect and cull the orphan
        // before we spawn so the new studio actually binds the port.
        if is_port_listening(DRIVER_PORT).await {
            warn!(
                port = DRIVER_PORT,
                "driver port already in use — killing orphan maestro studio"
            );
            kill_orphan_studios().await;
            // Also nuke the on-device driver: after an abnormal shutdown
            // (SIGKILL / crash / laptop sleep), the Android-side
            // instrumentation can be in a zombie state where a fresh
            // studio will happily reattach but subsequent RPCs return
            // empty (`bytes=84, has_root=false`). force-stop guarantees
            // the on-device side starts cold.
            force_stop_driver(serial).await;
            remove_adb_forward(serial).await;
            // Give the kernel a beat to release TIME_WAIT on the socket
            // before the fresh studio tries to bind.
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

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
                        "maestro studio exited before binding {}", DRIVER_PORT
                    );
                    return Err(AppError::RunnerFailed(format!(
                        "maestro studio exited before port {DRIVER_PORT} was ready (status: {status})"
                    )));
                }
            }

            if TcpStream::connect(addr).await.is_ok() {
                info!(
                    elapsed_ms = start.elapsed().as_millis(),
                    "maestro studio ready — driver listening on {}", DRIVER_PORT
                );
                return Ok(());
            }

            tokio::time::sleep(READY_POLL_INTERVAL).await;
        }
    }

    /// Graceful shutdown: kill the child, reap it, and tear down the
    /// adb forward the studio set up. Safe to call multiple times
    /// (idempotent).
    ///
    /// Removing the adb forward is critical: SIGKILL'ing the studio
    /// leaves adb's own `tcp:7001 → device:7001` forward in place, so
    /// `localhost:7001` still accepts TCP connections even though
    /// there's no driver on the device side. Any subsequent code that
    /// uses "is port 7001 open?" as a driver-readiness signal (our
    /// `await_ready`, the maestro CLI's own pre-flight check) would
    /// then race against a dead driver and fail mysteriously. Removing
    /// the forward here guarantees the next path — whether that's a
    /// CLI fallback or a fresh `StudioKeeper::start` — starts from a
    /// genuinely empty state.
    pub async fn stop(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            debug!(serial = %self.serial, "stopping maestro studio");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        remove_adb_forward(&self.serial).await;
        force_stop_driver(&self.serial).await;
    }

    /// Soft pause: kill only the host-side `maestro studio` subprocess.
    /// The on-device driver (`dev.mobile.maestro` + `.test` instrumentation)
    /// and the `adb forward tcp:7001` are intentionally left in place so a
    /// concurrent `maestro test` can talk to the driver immediately
    /// without paying a reinstall cost.
    ///
    /// Use this instead of `stop()` when you need the host-side studio
    /// out of the way (e.g. its dadb forwarder was conflicting with the
    /// test process) but still want the device-side driver hot.
    pub async fn pause(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            debug!(serial = %self.serial, "pausing maestro studio (soft)");
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

/// Best-effort check whether something is already listening on `port`
/// on localhost. A successful connect means yes; any error means we
/// should try to spawn (and let the bind surface the real error).
async fn is_port_listening(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).await.is_ok()
}

/// Package name of the on-device Maestro driver APK. Maestro installs
/// this package + a `.test` instrumentation to host the gRPC server.
/// Hardcoded because maestro hardcodes it too (see `maestro-android/…`
/// in mobile-dev-inc/maestro).
const DRIVER_PACKAGE: &str = "dev.mobile.maestro";

/// Nuke any in-memory state the on-device driver is holding. Kills both
/// the driver package and its test instrumentation, so the next spawn
/// (studio or `maestro hierarchy` CLI) re-installs from scratch instead
/// of reattaching to a zombie instrumentation left over after sleep /
/// USB disconnect / crash. `force-stop` is idempotent and cheap (~100 ms)
/// so we call it unconditionally on stop.
async fn force_stop_driver(serial: &str) {
    let bin = crate::device::adb::adb_bin();
    let test_pkg = format!("{DRIVER_PACKAGE}.test");
    for pkg in [DRIVER_PACKAGE, test_pkg.as_str()] {
        let _ = Command::new(&bin)
            .args(["-s", serial, "shell", "am", "force-stop", pkg])
            .output()
            .await;
    }
}

/// Remove the host-side adb forward that `maestro studio` set up.
/// Idempotent — if no forward exists `adb forward --remove` returns
/// non-zero and we silently ignore it. We use `ADB_BIN` (matching the
/// `device::adb` module) so a user with a non-default adb path still
/// works.
async fn remove_adb_forward(serial: &str) {
    let bin = crate::device::adb::adb_bin();
    let port_spec = format!("tcp:{DRIVER_PORT}");
    let _ = Command::new(&bin)
        .args(["-s", serial, "forward", "--remove", &port_spec])
        .output()
        .await;
}

/// Kill any `maestro studio` process lingering from a previous session.
/// Matches against the full command line via `pgrep -f` so it catches
/// both the CLI wrapper and the backing JVM (its classpath includes
/// `maestro.cli.AppKt`). Unix-only for now — Tauri targets macOS/Linux
/// first, and the app is not yet shipped on Windows.
async fn kill_orphan_studios() {
    #[cfg(unix)]
    {
        let Ok(output) = Command::new("pgrep")
            .args(["-f", "maestro.*studio"])
            .output()
            .await
        else {
            return;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let Ok(pid) = line.trim().parse::<u32>() else {
                continue;
            };
            warn!(pid, "SIGKILL orphan maestro studio");
            let _ = Command::new("kill")
                .args(["-9", &pid.to_string()])
                .output()
                .await;
        }
    }
}

/// Re-warm the `maestro studio` keeper for the currently-connected
/// device on a background tokio task. Safe to call from anywhere with an
/// `AppHandle`; never blocks and never returns an error to the caller.
///
/// Use this after a `maestro test` run completes so the next inspect
/// call hits the fast gRPC path instead of paying the ~10–15 s studio
/// startup cost.
///
/// If no device is connected when the task runs, it logs and returns —
/// the studio is meaningless without a target device.
pub fn schedule_studio_restart(app: tauri::AppHandle) {
    use tauri::Manager;

    tauri::async_runtime::spawn(async move {
        let state = app.state::<crate::state::AppState>();
        let serial = match state.connected_device.read().as_ref() {
            Some(d) => d.serial.clone(),
            None => {
                tracing::debug!("no device connected — skipping studio restart");
                return;
            }
        };
        match StudioKeeper::start(&serial).await {
            Ok(keeper) => {
                *state.studio.lock().await = Some(std::sync::Arc::new(keeper));
                tracing::info!(serial = %serial, "studio re-warmed after test");
            }
            Err(e) => {
                tracing::warn!(serial = %serial, error = ?e, "studio restart failed");
            }
        }
    });
}
