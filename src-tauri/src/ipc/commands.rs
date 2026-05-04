//! Tauri #[command] handlers.

use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::device::{adb, Device};
use crate::error::{AppError, AppResult};
use crate::maestro_health::{self, HealthReport, KillReport};
use crate::hierarchy::{self, HierarchyTree, UINode};
use crate::input::{self, InputEvent};
use crate::metrics;
use crate::runner;
use crate::scrcpy;
use crate::selector::{self, Selector, SpatialIndex};
use crate::state::AppState;
use crate::workspace::{self, WorkspaceNode};
use crate::yaml::{self, MaestroAction};

/// Channel depth for queued control messages. ~1s of bursty input at 60Hz.
const CONTROL_CHANNEL_DEPTH: usize = 64;

#[tauri::command]
pub fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[tauri::command]
pub fn list_devices() -> AppResult<Vec<Device>> {
    adb::list_devices()
}

#[tauri::command]
pub async fn connect_device(
    serial: String,
    stream_enabled: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let device = adb::get_device_info(&serial)?;
    info!(
        serial = %serial,
        model = %device.model,
        stream = stream_enabled,
        "device connected",
    );
    *state.connected_device.write() = Some(device);

    // Defensive cleanup: any leftover scrcpy server from a previous run holds
    // the abstract socket name and would block start_server with EADDRINUSE.
    teardown_scrcpy(&serial, state.inner()).await;

    if !stream_enabled {
        // Lightweight mode — no scrcpy. Inputs (taps/swipes) won't work since
        // they go through the scrcpy control channel, but inspect (Maestro
        // hierarchy) and run (maestro test) operate independently of the
        // stream.
        return Ok(());
    }

    setup_scrcpy(&serial, app, state.inner()).await;
    Ok(())
}

/// Bring up scrcpy for the currently connected device. Used by the settings
/// toggle to enable mirroring without forcing a full reconnect.
#[tauri::command]
pub async fn start_stream(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;
    // Tear any previous session down before starting a fresh one — same
    // EADDRINUSE / dangling-process protection as connect_device.
    teardown_scrcpy(&serial, state.inner()).await;
    setup_scrcpy(&serial, app, state.inner()).await;
    Ok(())
}

/// Tear down scrcpy without disconnecting the device. Run / inspect keep
/// working since they don't depend on the stream.
#[tauri::command]
pub async fn stop_stream(state: State<'_, AppState>) -> AppResult<()> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone());
    if let Some(serial) = serial {
        teardown_scrcpy(&serial, state.inner()).await;
    }
    Ok(())
}

async fn setup_scrcpy(serial: &str, app: AppHandle, state: &AppState) {
    if let Err(e) = scrcpy::push_server(serial) {
        warn!(error = ?e, "scrcpy push_server failed");
        return;
    }

    let scid = scrcpy::random_scid();
    *state.scid.write() = Some(scid.clone());

    if let Err(e) = scrcpy::create_tunnel(serial, scrcpy::DEFAULT_PORT, &scid) {
        warn!(error = ?e, "scrcpy create_tunnel failed");
        return;
    }

    let child = match scrcpy::spawn_server(serial, &scid) {
        Ok(c) => c,
        Err(e) => {
            warn!(error = ?e, "scrcpy spawn_server failed");
            return;
        }
    };
    *state.scrcpy_child.lock().await = Some(child);

    // The server takes ~100-300ms to bind the abstract socket. spawn_session
    // also retries internally, so a short delay here just trims dead time.
    tokio::time::sleep(std::time::Duration::from_millis(150)).await;

    let (tx, rx) = mpsc::channel::<Vec<u8>>(CONTROL_CHANNEL_DEPTH);
    match scrcpy::stream::spawn_session(app, scrcpy::DEFAULT_PORT, rx).await {
        Ok(handle) => {
            *state.stream_abort.lock().await = Some(handle.abort);
            *state.control_tx.lock().await = Some(tx);
        }
        Err(e) => {
            warn!(error = ?e, "scrcpy session connection failed");
        }
    }
}

#[tauri::command]
pub async fn disconnect_device(state: State<'_, AppState>) -> AppResult<()> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone());
    *state.connected_device.write() = None;
    *state.last_hierarchy.write() = None;
    *state.spatial_index.write() = None;

    // Tear down the background studio process if one was spawned for
    // fast-hierarchy mode — it holds an adb forward + instrumentation
    // session that must be released before another device can take
    // over the forwarded port.
    if let Some(keeper) = state.studio.lock().await.take() {
        keeper.stop().await;
    }

    if let Some(serial) = serial {
        teardown_scrcpy(&serial, state.inner()).await;
    }
    Ok(())
}

/// Tear down the scrcpy session: drop the control channel, abort the read
/// loop, kill the spawned `adb shell` child, kill any leftover server on the
/// device, and remove the adb forward.
async fn teardown_scrcpy(serial: &str, state: &AppState) {
    *state.control_tx.lock().await = None;
    if let Some(abort) = state.stream_abort.lock().await.take() {
        let _ = abort.send(());
    }
    if let Some(mut child) = state.scrcpy_child.lock().await.take() {
        let _ = child.kill().await;
    }
    scrcpy::pkill_scrcpy(serial);
    let _ = scrcpy::remove_tunnel(serial, scrcpy::DEFAULT_PORT);
    *state.scid.write() = None;
}

#[tauri::command]
pub async fn enter_inspect_mode(
    fast_mode: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<HierarchyTree> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;

    // Pre-flight: if the on-device driver isn't responding, force-stop
    // it and remove the port forward so the next maestro call spawns a
    // fresh driver instead of hanging for 120s on DEADLINE_EXCEEDED.
    let app_for_preflight = app.clone();
    let serial_for_preflight = serial.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::maestro_health::preflight_with_recovery(
            &app_for_preflight,
            &serial_for_preflight,
            "inspect",
        );
    })
    .await
    .ok();

    // Fast path: reuse a long-lived `maestro studio` subprocess that
    // keeps the on-device driver installed and listening on port 7001,
    // then talk gRPC directly to fetch the hierarchy. First call pays
    // the studio startup cost (~10-15 s); subsequent calls return in
    // <500 ms. Falls back to the CLI path if studio fails to start or
    // the gRPC RPC itself errors, so the app stays usable even when
    // the fast path is broken on a given setup.
    if fast_mode {
        match dump_via_grpc(&serial, state.inner()).await {
            Ok(tree) => return finalize_hierarchy(tree, state.inner()).await,
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "fast-hierarchy path failed, falling back to CLI dump"
                );
            }
        }
    }

    // `maestro hierarchy` spawns a subprocess and blocks on its stdout, which
    // can take 500–1500 ms. Run it on the blocking pool so the async runtime
    // stays free to service frame events, input taps, and other commands —
    // otherwise entering inspect mode freezes the whole app until the dump
    // returns. Likewise, SpatialIndex::build walks the full tree and can be
    // non-trivial on large hierarchies.
    let tree = tokio::task::spawn_blocking(move || hierarchy::dump_hierarchy(&serial))
        .await
        .map_err(|e| AppError::HierarchyParse(format!("dump task panicked: {e}")))??;

    finalize_hierarchy(tree, state.inner()).await
}

/// Fast-mode helper: ensure a `maestro studio` keeper is running for
/// the given device, then fetch the hierarchy over gRPC. Reuses an
/// existing keeper if one is already up to avoid paying studio's
/// 10-15 s startup cost on every inspect call.
async fn dump_via_grpc(serial: &str, state: &AppState) -> AppResult<HierarchyTree> {
    {
        let mut slot = state.studio.lock().await;
        let needs_spawn = match slot.as_ref() {
            Some(k) => k.serial() != serial,
            None => true,
        };
        if needs_spawn {
            if let Some(existing) = slot.take() {
                existing.stop().await;
            }
            let keeper = hierarchy::studio::StudioKeeper::start(serial).await?;
            *slot = Some(Arc::new(keeper));
        }
    }

    match hierarchy::grpc_client::dump_hierarchy().await {
        Ok(tree) => Ok(tree),
        Err(e @ AppError::StaleDriver(_)) => {
            // Driver is a zombie (orphan studio from a previous session,
            // or on-device instrumentation died after sleep/wake). Drop
            // the keeper so the next call respawns cleanly via the
            // orphan-kill path in `StudioKeeper::start`.
            if let Some(existing) = state.studio.lock().await.take() {
                existing.stop().await;
            }
            Err(e)
        }
        Err(e) => {
            // Transport errors, timeouts, parse errors: the keeper may
            // just be warming up after spawn. Leave it alive — the CLI
            // fallback in the caller will land the current request, and
            // the next inspect call reuses the warmed-up keeper at
            // ~300 ms instead of paying the full respawn cost again.
            Err(e)
        }
    }
}

/// Share the freshly-dumped tree across the cached state, spatial
/// index, and IPC return via a single Arc. One unavoidable deep clone
/// (for the frontend serializer); the rest are refcount bumps. Used
/// by both the CLI and gRPC paths so they land in identical state.
async fn finalize_hierarchy(tree: HierarchyTree, state: &AppState) -> AppResult<HierarchyTree> {
    let tree_arc = Arc::new(tree);

    let index_tree = tree_arc.clone();
    let spatial = tokio::task::spawn_blocking(move || {
        index_tree
            .root
            .as_ref()
            .map(|root| Arc::new(SpatialIndex::build(root)))
    })
    .await
    .map_err(|e| AppError::HierarchyParse(format!("index task panicked: {e}")))?;

    *state.last_hierarchy.write() = Some(tree_arc.clone());
    *state.spatial_index.write() = spatial;

    Ok(Arc::try_unwrap(tree_arc).unwrap_or_else(|arc| (*arc).clone()))
}

#[tauri::command]
pub fn query_element(x: i32, y: i32, state: State<'_, AppState>) -> AppResult<Option<UINode>> {
    let idx = state.spatial_index.read().clone();
    Ok(idx.and_then(|i| i.find_at(x, y)))
}

#[tauri::command]
pub fn suggest_selectors(node: UINode) -> Vec<Selector> {
    selector::suggest_selectors(&node)
}

#[tauri::command]
pub fn generate_command(action: MaestroAction) -> String {
    yaml::generate_command(&action)
}

#[tauri::command]
pub async fn send_input(
    event: InputEvent,
    screen_w: u16,
    screen_h: u16,
    state: State<'_, AppState>,
) -> AppResult<()> {
    // The caller knows which coordinate system its (x, y) values are in
    // (typically stream space, since coords come from the canvas) and passes
    // the matching screen dimensions. Trusting the frontend here avoids a
    // stream-vs-native mismatch on devices where scrcpy downscales (e.g.
    // QHD+ Galaxy with max_size=1080).
    if state.connected_device.read().is_none() {
        return Err(AppError::NoDevice);
    }
    input::send(&event, state.inner(), screen_w, screen_h).await
}

#[tauri::command]
pub async fn set_dark_mode(enabled: bool, state: State<'_, AppState>) -> AppResult<()> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;
    // `cmd uimode night yes|no` forces dark/light on Android 10+. It's a
    // per-session override (doesn't touch Settings) — exactly what a
    // test-harness needs. `spawn_blocking` because `exec_shell` shells
    // out to adb synchronously.
    let arg = if enabled { "yes" } else { "no" };
    let cmd = format!("cmd uimode night {arg}");
    tokio::task::spawn_blocking(move || adb::exec_shell(&serial, &cmd))
        .await
        .map_err(|e| AppError::Other(format!("set_dark_mode task panicked: {e}")))??;
    Ok(())
}

#[tauri::command]
pub async fn get_dark_mode(state: State<'_, AppState>) -> AppResult<bool> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;
    let out = tokio::task::spawn_blocking(move || adb::exec_shell(&serial, "cmd uimode night"))
        .await
        .map_err(|e| AppError::Other(format!("get_dark_mode task panicked: {e}")))??;
    // Typical output: "Night mode: yes" / "Night mode: no". `yes` is
    // returned whether the user forced it or auto-night resolved to
    // dark, which matches what the UI actually shows — so treat any
    // "yes" as "currently dark".
    Ok(out.to_lowercase().contains("yes"))
}

#[tauri::command]
pub async fn run_flow(
    file_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<u32> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;

    // Pre-flight: kick a hung driver if needed (see preflight spec).
    let app_for_preflight = app.clone();
    let serial_for_preflight = serial.clone();
    tauri::async_runtime::spawn_blocking(move || {
        crate::maestro_health::preflight_with_recovery(
            &app_for_preflight,
            &serial_for_preflight,
            "run_flow",
        );
    })
    .await
    .ok();

    // Ensure no `maestro studio` JVM is hogging port 7001 before we
    // spawn the test. Two cases to cover:
    //   1. The studio we currently manage (state.studio): tear it down
    //      via the keeper so the on-device driver state is clean.
    //   2. ORPHAN studios from a previous Maestro Deck session — the
    //      JVM survives Cmd+Q and `kill_on_drop`, leaks the port, and
    //      makes maestro test's dadb forwarder time out for 2 minutes
    //      on its first deviceInfo call. pkill catches them by their
    //      distinctive Maestro CLI cmdline pattern.
    if let Some(keeper) = state.studio.lock().await.take() {
        keeper.pause().await;
    }
    let _ = tokio::process::Command::new("pkill")
        .args(["-9", "-f", "maestro.cli.AppKt.*studio"])
        .output()
        .await;
    // Short beat for the OS to release the listening socket after the
    // JVM dies, so maestro test's own forwarder can bind cleanly.
    tokio::time::sleep(std::time::Duration::from_millis(300)).await;

    // Schedule a background re-warm of the studio after the runner exits
    // so the next inspect call stays fast.
    let on_exit: Option<Box<dyn FnOnce(AppHandle) + Send + 'static>> =
        Some(Box::new(|app: AppHandle| {
            crate::hierarchy::studio::schedule_studio_restart(app);
        }));

    runner::spawn_runner(app, &file_path, on_exit).await
}

#[tauri::command]
pub async fn stop_flow(pid: u32) -> AppResult<()> {
    runner::kill_runner(pid).await
}

#[tauri::command]
pub fn list_workspace(path: String) -> AppResult<WorkspaceNode> {
    workspace::list_workspace(std::path::Path::new(&path))
}

#[tauri::command]
pub async fn start_metrics(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;
    metrics::start(app, serial).await
}

#[tauri::command]
pub async fn stop_metrics() -> AppResult<()> {
    metrics::stop().await
}

#[tauri::command]
pub fn check_device_health(serial: String) -> AppResult<HealthReport> {
    maestro_health::detect::check_device_health(&serial)
}

#[tauri::command]
pub fn kill_maestro_processes(serial: String, report: HealthReport) -> AppResult<KillReport> {
    maestro_health::kill::kill_maestro_processes(&serial, report)
}

impl serde::Serialize for HierarchyTree {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("HierarchyTree", 2)?;
        st.serialize_field("root", &self.root)?;
        st.serialize_field("xml_raw", &self.xml_raw)?;
        st.end()
    }
}
