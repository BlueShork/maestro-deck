// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Keep a background `maestro mcp` process alive so the on-device
//! driver stays installed and its gRPC server stays bound to port 7001.
//! `maestro mcp` caches one driver session per device: the warm-up tool
//! call below makes it install the driver APKs and start the
//! instrumentation, and the session then lives as long as the process.
//! (Maestro ≤ 2.5 did this through `maestro studio`, removed in 2.6.)
//!
//! Once `start()` returns, callers can connect a tonic client to
//! `http://127.0.0.1:7001` and issue `MaestroDriver` RPCs directly —
//! bypassing the slow one-shot `maestro hierarchy` CLI path entirely.
//!
//! Lifecycle: the returned `DriverKeeper` owns the child process.
//! `stop()` is the preferred graceful shutdown; dropping the keeper
//! falls back to `kill_on_drop(true)` (SIGKILL) to guarantee the
//! subprocess never outlives the app.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::net::TcpStream;
use tokio::process::Command;
use tracing::{debug, info, warn};

use crate::error::{AppError, AppResult};
use crate::maestro_mcp::McpClient;
use crate::process_ext::CommandExtNoWindow;

/// The gRPC port the on-device Maestro driver binds to. The Maestro
/// CLI hardcodes this in `DefaultDriverHostPort`; we forward the same
/// port from localhost with `adb forward`.
pub const DRIVER_PORT: u16 = 7001;

/// How long we wait for the driver to be installed and listening, after
/// the MCP handshake. Dominated by the APK install (~5-8 s) + the
/// instrumentation start; 40 s gives a comfortable margin on slow machines.
const DRIVER_READY_TIMEOUT: Duration = Duration::from_secs(40);
/// Poll interval while probing the on-device port.
const READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Budget for the warm-up tool call (driver install + first hierarchy).
const WARMUP_TIMEOUT: Duration = Duration::from_secs(120);

/// Command-line needles of an Android keeper: `maestro --udid <serial> mcp
/// --no-viewer`. The `--udid` global flag is what tells our keepers apart
/// from a user's own `maestro mcp` server (see `maestro_mcp`).
const ANDROID_KEEPER_NEEDLES: &[&str] = &["maestro", "--udid", "mcp", "--no-viewer"];

pub struct DriverKeeper {
    mcp: Arc<McpClient>,
    serial: String,
    /// Error from the warm-up tool call (device not found, install
    /// refused…) — lets `await_ready` fail fast instead of timing out.
    warmup_error: Arc<parking_lot::Mutex<Option<String>>>,
}

impl DriverKeeper {
    /// Spawn `maestro --udid <serial> mcp` and wait until the gRPC driver
    /// is listening on the device. Returns as soon as it is — the caller
    /// can immediately issue RPCs against `localhost:7001`.
    pub async fn start(serial: &str) -> AppResult<Self> {
        // If a previous maestro-deck session was SIGKILLed or crashed,
        // `kill_on_drop` never fires and the keeper outlives the app,
        // holding a stale driver session that returns an empty
        // `<hierarchy/>` blob — the user sees "Empty hierarchy" forever.
        // Detect and cull the orphan before we spawn.
        if is_port_listening(DRIVER_PORT).await {
            warn!(
                port = DRIVER_PORT,
                "driver port already in use — killing orphan driver keepers"
            );
            kill_orphan_keepers().await;
            // Also nuke the on-device driver: after an abnormal shutdown
            // (SIGKILL / crash / laptop sleep), the Android-side
            // instrumentation can be in a zombie state where a fresh
            // session will happily reattach but subsequent RPCs return
            // empty (`bytes=84, has_root=false`). force-stop guarantees
            // the on-device side starts cold.
            force_stop_driver(serial).await;
            remove_adb_forward(serial).await;
            // Give the kernel a beat to release TIME_WAIT on the socket.
            tokio::time::sleep(Duration::from_millis(250)).await;
        }

        info!(
            serial,
            port = DRIVER_PORT,
            "spawning maestro mcp to keep driver warm"
        );
        let mcp = Arc::new(McpClient::spawn(&["--udid", serial], &[]).await?);

        // Maestro 2.5+ talks to the driver through an in-process
        // adb-socket factory, so nothing is exposed on localhost:7001.
        // Our gRPC client wants plain TCP, so we set up the forward
        // ourselves. It's held by the adb-server, independent of any
        // maestro process — `maestro test`'s adb-socket talks via a
        // different path and won't collide with this forward.
        let port_spec = format!("tcp:{DRIVER_PORT}");
        let adb = crate::device::adb::adb_bin();
        let _ = Command::new(&adb)
            .no_window()
            .args(["-s", serial, "forward", &port_spec, &port_spec])
            .output()
            .await;

        let keeper = Self {
            mcp,
            serial: serial.to_string(),
            warmup_error: Arc::default(),
        };
        keeper.spawn_warmup();
        keeper.await_ready().await?;
        Ok(keeper)
    }

    /// Fire the tool call that opens the device session (installs + starts
    /// the driver). Runs in the background: readiness is observed on the
    /// device itself, and the call's result only matters if it fails.
    fn spawn_warmup(&self) {
        let mcp = self.mcp.clone();
        let err_slot = self.warmup_error.clone();
        let args = serde_json::json!({ "device_id": self.serial });
        tokio::spawn(async move {
            if let Err(e) = mcp.call_tool("inspect_screen", args, WARMUP_TIMEOUT).await {
                warn!(error = %e, "driver keeper warm-up failed");
                *err_slot.lock() = Some(e.to_string());
            }
        });
    }

    /// Wait until the on-device instrumentation is actually serving on
    /// port 7001. With our manual `adb forward`, a plain TCP connect to
    /// `localhost:7001` would succeed immediately (adb-server holds the
    /// listener) regardless of whether the device side is ready — so we
    /// poll the device directly via `ss -tlnp`. Bails early if the keeper
    /// exits or its warm-up call fails.
    async fn await_ready(&self) -> AppResult<()> {
        let deadline = Instant::now() + DRIVER_READY_TIMEOUT;
        let start = Instant::now();
        let adb = crate::device::adb::adb_bin();

        loop {
            if Instant::now() >= deadline {
                return Err(AppError::RunnerFailed(format!(
                    "the maestro driver did not open port {DRIVER_PORT} within {:?}",
                    DRIVER_READY_TIMEOUT
                )));
            }

            if let Some(status) = self.mcp.exit_status().await {
                warn!(?status, "maestro mcp exited before binding {}", DRIVER_PORT);
                return Err(AppError::RunnerFailed(format!(
                    "maestro mcp exited before port {DRIVER_PORT} was ready (status: {status})"
                )));
            }
            if let Some(e) = self.warmup_error.lock().clone() {
                return Err(AppError::RunnerFailed(format!(
                    "maestro could not start its driver on {}: {e}",
                    self.serial
                )));
            }

            // Probe the on-device side: `ss -tlnp` lists listening TCP
            // sockets. Port 7001 (0x1B59) appears in the local-addr
            // column once the maestro instrumentation has bound it.
            // We grep with both decimal and hex forms because `ss` on
            // some Android builds renders local addr in hex (proc-net
            // style: `0100007F:1B59`).
            let listening = match Command::new(&adb)
                .no_window()
                .args(["-s", &self.serial, "shell", "ss", "-tln"])
                .output()
                .await
            {
                Ok(out) => {
                    let s = String::from_utf8_lossy(&out.stdout);
                    s.lines().any(|line| {
                        line.contains(":7001 ")
                            || line.contains(":7001\t")
                            || line.contains(":1B59 ")
                            || line.contains(":1B59\t")
                    })
                }
                Err(_) => false,
            };

            if listening {
                info!(
                    elapsed_ms = start.elapsed().as_millis(),
                    "driver keeper ready — instrumentation listening on device {}", DRIVER_PORT
                );
                return Ok(());
            }

            tokio::time::sleep(READY_POLL_INTERVAL).await;
        }
    }

    /// Graceful shutdown: kill the child, reap it, and tear down the
    /// adb forward we set up. Safe to call multiple times (idempotent).
    ///
    /// Removing the adb forward is critical: SIGKILL'ing the keeper
    /// leaves adb's own `tcp:7001 → device:7001` forward in place, so
    /// `localhost:7001` still accepts TCP connections even though
    /// there's no driver on the device side. Any subsequent code that
    /// uses "is port 7001 open?" as a driver-readiness signal (our
    /// `await_ready`, the maestro CLI's own pre-flight check) would
    /// then race against a dead driver and fail mysteriously. Removing
    /// the forward here guarantees the next path — whether that's a
    /// CLI fallback or a fresh `DriverKeeper::start` — starts from a
    /// genuinely empty state.
    pub async fn stop(&self) {
        debug!(serial = %self.serial, "stopping driver keeper");
        self.mcp.stop().await;
        remove_adb_forward(&self.serial).await;
        force_stop_driver(&self.serial).await;
    }

    /// Soft pause: kill only the host-side `maestro mcp` subprocess.
    /// The on-device driver (`dev.mobile.maestro` + `.test` instrumentation)
    /// and the `adb forward tcp:7001` are intentionally left in place so a
    /// concurrent `maestro test` can talk to the driver immediately
    /// without paying a reinstall cost.
    ///
    /// Use this instead of `stop()` when you need the host-side keeper
    /// out of the way (e.g. its dadb forwarder was conflicting with the
    /// test process) but still want the device-side driver hot.
    pub async fn pause(&self) {
        debug!(serial = %self.serial, "pausing driver keeper (soft)");
        self.mcp.stop().await;
    }

    pub fn serial(&self) -> &str {
        &self.serial
    }
}

// Tokio's `Child` was spawned with `kill_on_drop(true)`, so when a
// `DriverKeeper` is dropped the runtime will SIGKILL the subprocess
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
/// (keeper or `maestro hierarchy` CLI) re-installs from scratch instead
/// of reattaching to a zombie instrumentation left over after sleep /
/// USB disconnect / crash. `force-stop` is idempotent and cheap (~100 ms)
/// so we call it unconditionally on stop.
async fn force_stop_driver(serial: &str) {
    let bin = crate::device::adb::adb_bin();
    let test_pkg = format!("{DRIVER_PACKAGE}.test");
    for pkg in [DRIVER_PACKAGE, test_pkg.as_str()] {
        let _ = Command::new(&bin)
            .no_window()
            .args(["-s", serial, "shell", "am", "force-stop", pkg])
            .output()
            .await;
    }
}

/// Remove the host-side adb forward set up in `DriverKeeper::start`.
/// Idempotent — if no forward exists `adb forward --remove` returns
/// non-zero and we silently ignore it. We use `ADB_BIN` (matching the
/// `device::adb` module) so a user with a non-default adb path still
/// works.
async fn remove_adb_forward(serial: &str) {
    let bin = crate::device::adb::adb_bin();
    let port_spec = format!("tcp:{DRIVER_PORT}");
    let _ = Command::new(&bin)
        .no_window()
        .args(["-s", serial, "forward", "--remove", &port_spec])
        .output()
        .await;
}

/// Kill any Android driver keeper lingering from a previous session
/// (`maestro --udid <serial> mcp --no-viewer`). Matched on the full
/// command line, so it catches the backing JVM too (its classpath
/// includes `maestro.cli.AppKt`), and never a user's own `maestro mcp`
/// (no `--udid`). iOS keepers use `--device`, so they are never hit.
async fn kill_orphan_keepers() {
    crate::prockill::kill_matching(ANDROID_KEEPER_NEEDLES, "orphan Android driver keeper").await;
}

/// Re-warm the driver keeper for the currently-connected device on a
/// background tokio task. Safe to call from anywhere with an
/// `AppHandle`; never blocks and never returns an error to the caller.
///
/// Use this after a `maestro test` run completes so the next inspect
/// call hits the fast gRPC path instead of paying the ~10–15 s keeper
/// startup cost.
///
/// If no device is connected when the task runs, it logs and returns —
/// the keeper is meaningless without a target device.
pub fn schedule_driver_restart(app: tauri::AppHandle) {
    use tauri::Manager;

    tauri::async_runtime::spawn(async move {
        let state = app.state::<crate::state::AppState>();
        let serial = match state.connected_device.read().as_ref() {
            Some(d) => d.serial.clone(),
            None => {
                tracing::debug!("no device connected — skipping driver keeper restart");
                return;
            }
        };
        match DriverKeeper::start(&serial).await {
            Ok(keeper) => {
                *state.driver_keeper.lock().await = Some(std::sync::Arc::new(keeper));
                tracing::info!(serial = %serial, "driver keeper re-warmed after test");
            }
            Err(e) => {
                tracing::warn!(serial = %serial, error = ?e, "driver keeper restart failed");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Live end-to-end check on a connected Android device: the keeper
    /// brings the driver up and a gRPC dump returns a real hierarchy.
    ///   MAESTRO_BIN=/path/to/maestro-2.10.0 ANDROID_SERIAL=<serial> cargo test \
    ///     --manifest-path src-tauri/Cargo.toml android_keeper_end_to_end -- --ignored --nocapture
    #[tokio::test(flavor = "multi_thread")]
    #[ignore]
    async fn android_keeper_end_to_end() {
        let serial = std::env::var("ANDROID_SERIAL").expect("set ANDROID_SERIAL");
        let t = Instant::now();
        let keeper = DriverKeeper::start(&serial).await.expect("start keeper");
        eprintln!("driver ready in {:?}", t.elapsed());
        for n in 0..3 {
            let t = Instant::now();
            let tree = crate::hierarchy::grpc_client::dump_hierarchy()
                .await
                .expect("gRPC dump");
            eprintln!(
                "dump {n}: {} bytes in {:?}",
                tree.xml_raw.len(),
                t.elapsed()
            );
            assert!(tree.root.is_some());
        }
        keeper.stop().await;
        assert!(!keeper.mcp.is_alive().await);
    }

    #[test]
    fn orphan_sweep_targets_only_android_keepers() {
        use crate::prockill::cmdline_matches;
        let jvm = "/usr/bin/java -classpath /opt/maestro/lib/* maestro.cli.AppKt --udid emulator-5554 mcp --no-viewer";
        assert!(cmdline_matches(jvm, ANDROID_KEEPER_NEEDLES));
        // A user's own MCP server (e.g. an AI assistant's) carries no --udid.
        let user_mcp = "/usr/bin/java -classpath /opt/maestro/lib/* maestro.cli.AppKt mcp";
        assert!(!cmdline_matches(user_mcp, ANDROID_KEEPER_NEEDLES));
        // iOS simulator keepers use --device.
        let ios = "/usr/bin/java -classpath /opt/maestro/lib/* maestro.cli.AppKt --device ABC mcp --no-viewer";
        assert!(!cmdline_matches(ios, ANDROID_KEEPER_NEEDLES));
    }
}
