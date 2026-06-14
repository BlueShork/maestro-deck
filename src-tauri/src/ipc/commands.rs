// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Tauri #[command] handlers.

use std::sync::Arc;

#[cfg(target_os = "macos")]
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::device::{adb, Device};
use crate::error::{AppError, AppResult};
use crate::hierarchy::{self, HierarchyTree, UINode};
use crate::input::{self, InputEvent};
use crate::maestro_health::{self, HealthReport, KillReport};
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
    // Each platform's discovery degrades independently — a failure in one
    // must not blank out the other's devices.
    let mut devices = match adb::list_devices() {
        Ok(d) => d,
        Err(e) => {
            warn!(error = ?e, "android device discovery failed");
            Vec::new()
        }
    };
    match crate::device::ios::list_devices() {
        Ok(ios) => devices.extend(ios),
        Err(e) => warn!(error = ?e, "ios device discovery failed"),
    }
    // Web is always available as a synthetic target; connect-time errors
    // surface if maestro/Chromium can't start.
    devices.push(crate::device::web::synthetic_target());
    Ok(devices)
}

#[tauri::command]
pub async fn connect_device(
    serial: String,
    stream_enabled: bool,
    platform: crate::device::Platform,
    url: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    use crate::device::Platform;
    match platform {
        Platform::Android => {
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
        Platform::Ios => {
            // Resolve model/OS for display (simctl, fast). Screen size is unknown
            // until the driver's /deviceInfo is ready; the canvas uses the
            // screenshot's own dimensions, and input reads dims from the keeper.
            let device = crate::device::ios::list_devices()?
                .into_iter()
                .find(|d| d.serial == serial)
                .ok_or(AppError::NoDevice)?;
            info!(udid = %serial, model = %device.model, stream = stream_enabled, "iOS device connected");
            *state.connected_device.write() = Some(device);

            // Boot the sim + spawn the driver WITHOUT blocking on readiness.
            let keeper = ensure_ios_keeper(&serial, state.inner()).await?;

            // Show the screen immediately — the poller captures via simctl,
            // independent of the (still-warming) XCTest driver.
            if stream_enabled {
                let abort = crate::ios_session::spawn_screenshot_poller(app, keeper.clone());
                *state.ios_screenshot_abort.lock().await = Some(abort);
            }

            // Warm the XCTest driver in the background so inspect/tap become
            // available (~1-2 min on a cold sim) without blocking the connect.
            tokio::spawn(async move {
                keeper.wait_until_ready().await;
            });
            Ok(())
        }
        Platform::Web => {
            // `url` is read from the open flow's `url:` header on the frontend
            // and navigated to on a fresh studio spawn.
            let keeper = ensure_web_keeper(url.as_deref(), state.inner()).await?;
            let mut device = crate::device::web::synthetic_target();
            if let Ok(s) = keeper.http().device_screen().await {
                device.screen_width = s.width;
                device.screen_height = s.height;
            }
            info!(stream = stream_enabled, "web browser connected");
            *state.connected_device.write() = Some(device);
            if stream_enabled {
                let abort = crate::web_session::spawn_screenshot_poller(app, keeper);
                *state.web_screenshot_abort.lock().await = Some(abort);
            }
            Ok(())
        }
    }
}

/// Upgrade the iOS live preview from the `simctl` screenshot poll to a fluid
/// headless-framebuffer stream. Called by the frontend once an iOS device is
/// connected with streaming. Waits for the background-warmed driver to become
/// ready (the crop needs `device_info` for the aspect-ratio crop) before
/// attempting the upgrade. Returns `true` if the native preview took over
/// (screenshot poller aborted), `false` if it was unavailable and the
/// screenshot poller keeps running. Never errors in a way that blanks the
/// screen.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn upgrade_ios_preview(
    channel: Channel<InvokeResponseBody>,
    state: State<'_, AppState>,
) -> AppResult<bool> {
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)?;
    if device.platform != crate::device::Platform::Ios {
        return Ok(false);
    }
    let keeper = match state.ios_driver.lock().await.clone() {
        Some(k) => k,
        None => return Ok(false),
    };

    // SIMULATOR ONLY: the connect flow warms the driver in the background;
    // `device_info` (needed for the aspect-ratio crop) only exists once the
    // driver is ready, so wait for it. `wait_until_ready` is idempotent /
    // concurrent-safe and returns `false` promptly on teardown.
    //
    // PHYSICAL: the AVF USB mirror is completely driver-independent (its frame
    // IS the pure device screen, dims come from the frame itself) — start it
    // right away so the user sees the screen while the XCTest driver is still
    // building on the device (~10 min on first connect). Waiting here used to
    // time out (180 s readiness budget < build time) and leave the preview
    // blank for the whole build.
    if !keeper.is_physical() && !keeper.wait_until_ready().await {
        return Ok(false);
    }

    match crate::ios_session::spawn_ios_preview(keeper.clone(), device.model.clone(), channel).await
    {
        Ok(handle) => {
            // Guard: the user may have disconnected or switched devices during
            // the readiness wait / preview start. If so, don't install a stale
            // session (which would leak); tear it down immediately.
            let still_connected = state
                .connected_device
                .read()
                .as_ref()
                .map(|d| d.serial.as_str() == keeper.udid())
                .unwrap_or(false);
            if !still_connected {
                handle.teardown().await;
                return Ok(false);
            }

            if let Some(abort) = state.ios_screenshot_abort.lock().await.take() {
                let _ = abort.send(());
            }
            if let Some(old) = state.ios_preview_session.lock().await.take() {
                old.teardown().await;
            }
            *state.ios_preview_session.lock().await = Some(handle);
            info!("iOS preview upgraded to headless framebuffer");
            Ok(true)
        }
        Err(e) => {
            info!(error = %e, "native preview unavailable; staying on screenshot poller");
            Ok(false)
        }
    }
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn upgrade_ios_preview(
    _channel: tauri::ipc::Channel<tauri::ipc::InvokeResponseBody>,
    _state: State<'_, AppState>,
) -> AppResult<bool> {
    Ok(false)
}

/// Bring up scrcpy for the currently connected device. Used by the settings
/// toggle to enable mirroring without forcing a full reconnect.
#[tauri::command]
pub async fn start_stream(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)?;
    match device.platform {
        crate::device::Platform::Android => {
            // Tear any previous session down before starting a fresh one — same
            // EADDRINUSE / dangling-process protection as connect_device.
            teardown_scrcpy(&device.serial, state.inner()).await;
            setup_scrcpy(&device.serial, app, state.inner()).await;
        }
        crate::device::Platform::Ios => {
            if let Some(abort) = state.ios_screenshot_abort.lock().await.take() {
                let _ = abort.send(());
            }
            #[cfg(target_os = "macos")]
            if let Some(handle) = state.ios_preview_session.lock().await.take() {
                handle.teardown().await;
            }
            let keeper = ensure_ios_keeper(&device.serial, state.inner()).await?;
            let abort = crate::ios_session::spawn_screenshot_poller(app, keeper);
            *state.ios_screenshot_abort.lock().await = Some(abort);
        }
        crate::device::Platform::Web => {
            if let Some(abort) = state.web_screenshot_abort.lock().await.take() {
                let _ = abort.send(());
            }
            let keeper = ensure_web_keeper(None, state.inner()).await?;
            let abort = crate::web_session::spawn_screenshot_poller(app, keeper);
            *state.web_screenshot_abort.lock().await = Some(abort);
        }
    }
    Ok(())
}

/// Tear down scrcpy without disconnecting the device. Run / inspect keep
/// working since they don't depend on the stream.
#[tauri::command]
pub async fn stop_stream(state: State<'_, AppState>) -> AppResult<()> {
    // Snapshot platform + serial under one guard (dropped before any await), so
    // a concurrent disconnect can't make the two reads disagree.
    let (platform, serial) = {
        let g = state.connected_device.read();
        (
            g.as_ref().map(|d| d.platform),
            g.as_ref().map(|d| d.serial.clone()),
        )
    };
    match platform {
        Some(crate::device::Platform::Ios) => {
            if let Some(abort) = state.ios_screenshot_abort.lock().await.take() {
                let _ = abort.send(());
            }
        }
        Some(crate::device::Platform::Android) => {
            if let Some(serial) = serial {
                teardown_scrcpy(&serial, state.inner()).await;
            }
        }
        Some(crate::device::Platform::Web) => {
            if let Some(abort) = state.web_screenshot_abort.lock().await.take() {
                let _ = abort.send(());
            }
        }
        None => {}
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
    teardown_all_sessions(state.inner()).await;
    Ok(())
}

/// Tear down every running session and its spawned subprocesses: the
/// background `maestro studio` keeper plus the connected platform's stream /
/// driver / browser. Shared by `disconnect_device` and the quit handler so a
/// fast Cmd+Q doesn't leave orphaned studio / chromedriver / Chrome / iproxy
/// processes behind.
pub async fn teardown_all_sessions(state: &AppState) {
    let (serial, platform) = {
        let g = state.connected_device.read();
        (
            g.as_ref().map(|d| d.serial.clone()),
            g.as_ref().map(|d| d.platform),
        )
    };
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

    match platform {
        Some(crate::device::Platform::Ios) => teardown_ios(state).await,
        Some(crate::device::Platform::Android) => {
            if let Some(serial) = serial {
                teardown_scrcpy(&serial, state).await;
            }
        }
        Some(crate::device::Platform::Web) => teardown_web(state).await,
        None => {}
    }
}

/// Cleanly quit the app: tear down all sessions (so nothing is orphaned), then
/// exit. Called by the frontend once the user confirms the quit dialog (or has
/// opted out of it). Setting `quit_confirmed` lets the subsequent exit through
/// the close/exit guards installed in `lib.rs`.
#[tauri::command]
pub async fn confirm_quit(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    state
        .quit_confirmed
        .store(true, std::sync::atomic::Ordering::SeqCst);
    teardown_all_sessions(state.inner()).await;
    app.exit(0);
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

/// Tear down the iOS session: stop the screenshot poller, the native preview
/// stream (if active), and the keeper (kills `maestro studio` + `iproxy`).
async fn teardown_ios(state: &AppState) {
    if let Some(abort) = state.ios_screenshot_abort.lock().await.take() {
        let _ = abort.send(());
    }
    #[cfg(target_os = "macos")]
    if let Some(handle) = state.ios_preview_session.lock().await.take() {
        handle.teardown().await;
    }
    if let Some(keeper) = state.ios_driver.lock().await.take() {
        keeper.stop().await;
    }
}

/// Ensure a `WebStudioKeeper` is running, returning it. Respawns if the cached
/// keeper has died. `url` is navigated to on a fresh spawn (from the open flow).
async fn ensure_web_keeper(
    url: Option<&str>,
    state: &AppState,
) -> AppResult<std::sync::Arc<crate::web_session::WebStudioKeeper>> {
    let mut slot = state.web_driver.lock().await;
    let alive = match slot.as_ref() {
        Some(k) => k.http().is_alive().await,
        None => false,
    };
    if !alive {
        if let Some(existing) = slot.take() {
            existing.stop().await;
        }
        let keeper =
            crate::web_session::WebStudioKeeper::start(crate::web_session::STUDIO_PORT, url)
                .await?;
        *slot = Some(keeper);
    }
    Ok(slot.as_ref().unwrap().clone())
}

/// Tear down the web session: stop the poller and kill the studio process.
async fn teardown_web(state: &AppState) {
    if let Some(abort) = state.web_screenshot_abort.lock().await.take() {
        let _ = abort.send(());
    }
    if let Some(keeper) = state.web_driver.lock().await.take() {
        keeper.stop().await;
    }
}

#[tauri::command]
pub async fn enter_inspect_mode(
    fast_mode: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<HierarchyTree> {
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)?;
    if device.platform == crate::device::Platform::Ios {
        let keeper = ensure_ios_keeper(&device.serial, state.inner()).await?;
        if !keeper.wait_until_ready().await {
            return Err(AppError::IosDriverUnreachable(
                "the iOS simulator driver is still starting — try again in a moment".into(),
            ));
        }
        // One transient "unreachable" right after a keeper respawn is common
        // (the bridge just rebound its port); the driver answers on the
        // immediate retry — don't make the user click Inspect twice.
        let json = match keeper.http().view_hierarchy().await {
            Ok(j) => j,
            Err(AppError::IosDriverUnreachable(_)) => {
                tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
                keeper.http().view_hierarchy().await?
            }
            Err(e) => return Err(e),
        };
        let screen = keeper
            .device_info()
            .map(|d| (d.width_points as i32, d.height_points as i32));
        let tree = crate::hierarchy::ios::parse_ios_axelement(&json, screen)?;
        return finalize_hierarchy(tree, state.inner()).await;
    }
    if device.platform == crate::device::Platform::Web {
        let keeper = ensure_web_keeper(None, state.inner()).await?;
        let screen = keeper.http().device_screen().await?;
        let tree = crate::hierarchy::web::parse_device_screen_hierarchy(
            &screen.elements,
            (screen.width, screen.height),
        )?;
        return finalize_hierarchy(tree, state.inner()).await;
    }
    let serial = device.serial.clone();

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

async fn ensure_ios_keeper(
    udid: &str,
    state: &AppState,
) -> AppResult<std::sync::Arc<crate::ios_session::IosDriverKeeper>> {
    // The keeper is always for the currently-connected device, so read its
    // physical flag from state rather than threading it through every caller.
    let physical = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.physical)
        .unwrap_or(false);
    let mut slot = state.ios_driver.lock().await;
    // Reuse the keeper for the same device while its bridge process
    // (`maestro studio` / `maestro-ios-device`) is still running — even if the
    // driver isn't *ready* yet (it may be warming). Respawn for a different
    // device, a dead process, OR a zombie bridge whose on-device runner died
    // (JVM alive, nothing listening on :22087 — `is_healthy` probes /status
    // with a short TTL so taps/Home self-heal instead of failing forever).
    let reuse = match slot.as_ref() {
        Some(k) => k.udid() == udid && k.is_process_alive().await && k.is_healthy().await,
        None => false,
    };
    if !reuse {
        // A simulator run owns the :22087 driver exclusively. Re-warming a
        // keeper now (e.g. an inspector auto-dump or a tap) would spawn a
        // second `maestro studio` that fights `maestro test` for the driver —
        // and both hang forever. Refuse until the run clears the flag.
        if !physical
            && state
                .ios_sim_run_active
                .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(AppError::IosDriverUnreachable(
                "a test is running on the simulator — inspect and tap are paused until it finishes"
                    .into(),
            ));
        }
        if let Some(existing) = slot.take() {
            existing.stop().await;
        }
        *slot = Some(crate::ios_session::IosDriverKeeper::spawn(udid, physical).await?);
    }
    Ok(slot.as_ref().unwrap().clone())
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
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)?;
    match device.platform {
        crate::device::Platform::Android => {
            input::send(&event, state.inner(), screen_w, screen_h).await
        }
        crate::device::Platform::Ios => {
            let keeper = ensure_ios_keeper(&device.serial, state.inner()).await?;
            if !keeper.wait_until_ready().await {
                return Err(AppError::IosDriverUnreachable(
                    "the iOS simulator driver is still starting".into(),
                ));
            }
            let (pt_w, pt_h) = keeper
                .device_info()
                .map(|d| (d.width_points, d.height_points))
                .unwrap_or((0, 0));
            input::ios::send(&event, keeper.http(), screen_w, screen_h, pt_w, pt_h).await
        }
        crate::device::Platform::Web => {
            let keeper = ensure_web_keeper(None, state.inner()).await?;
            input::web::send(&event, keeper.http(), screen_w, screen_h).await
        }
    }
}

/// Press the iOS Home button (return to the home screen). iOS-only: the XCTest
/// `/pressButton` route maps to `XCUIDevice.shared.press(.home)`. Errors if the
/// connected device isn't an iOS simulator.
#[tauri::command]
pub async fn ios_press_home(state: State<'_, AppState>) -> AppResult<()> {
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)?;
    if device.platform != crate::device::Platform::Ios {
        return Err(AppError::IosCommandFailed(
            "Home button is only available for iOS devices".into(),
        ));
    }
    let keeper = ensure_ios_keeper(&device.serial, state.inner()).await?;
    if !keeper.wait_until_ready().await {
        return Err(AppError::IosDriverUnreachable(
            "the iOS simulator driver is still starting".into(),
        ));
    }
    keeper.http().press_button("home").await
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

/// Whether the `maestro-ios-device` bridge (devicelab) is installed. The
/// frontend uses this to decide whether to offer the one-click auto-install for
/// physical iOS support.
#[tauri::command]
pub fn ios_device_bridge_installed() -> bool {
    crate::tool_paths::maestro_ios_device_installed()
}

/// Auto-install the `maestro-ios-device` bridge (Option A): download the release
/// binary for this Mac's arch, mark it executable, run its `setup` (which fetches
/// the XCTest runner + patched maestro **2.5.1** jars into `~/.maestro`), and
/// persist its path. We ship our own fork (BlueShork/maestro-ios-device) because
/// upstream devicelab only patches maestro 2.0.9–2.1.0; ours adds 2.5.1. Apache-2.0,
/// so redistribution-by-fetch is fine. Only users who actually connect a physical
/// iPhone ever trigger this.
#[tauri::command]
pub async fn install_ios_device_bridge() -> AppResult<String> {
    if !cfg!(target_os = "macos") {
        return Err(AppError::Other("physical iOS support is macOS-only".into()));
    }
    let arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        other => {
            return Err(AppError::Other(format!(
                "no maestro-ios-device build for this architecture ({other})"
            )))
        }
    };
    let url = format!(
        "https://github.com/BlueShork/maestro-ios-device/releases/latest/download/maestro-ios-device-darwin-{arch}"
    );
    info!(%url, "downloading maestro-ios-device bridge");

    let bytes = reqwest::Client::builder()
        .build()
        .map_err(|e| AppError::Other(format!("http client: {e}")))?
        .get(&url)
        .send()
        .await
        .map_err(|e| AppError::Other(format!("download maestro-ios-device: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::Other(format!("download maestro-ios-device: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::Other(format!("read maestro-ios-device: {e}")))?;

    let home =
        std::env::var_os("HOME").ok_or_else(|| AppError::Other("no HOME directory".into()))?;
    let dir = std::path::PathBuf::from(home).join(".maestro/bin");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(AppError::Io)?;
    let dest = dir.join("maestro-ios-device");
    tokio::fs::write(&dest, &bytes)
        .await
        .map_err(AppError::Io)?;
    // chmod +x — Unix-only. This whole command returns early on non-macOS above,
    // so the bridge is never installed off-Unix; the `cfg` just keeps the binary
    // compiling on Windows (where `PermissionsExt`/`set_mode` don't exist).
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perm = tokio::fs::metadata(&dest)
            .await
            .map_err(AppError::Io)?
            .permissions();
        perm.set_mode(0o755);
        tokio::fs::set_permissions(&dest, perm)
            .await
            .map_err(AppError::Io)?;
    }

    // `setup` fetches the prebuilt XCTest runner + patched maestro jars into
    // ~/.maestro. No device required for this step.
    info!("running maestro-ios-device setup");
    let out = tokio::process::Command::new(&dest)
        .arg("setup")
        .output()
        .await
        .map_err(|e| AppError::Other(format!("maestro-ios-device setup: {e}")))?;
    if !out.status.success() {
        // The Go bridge prints its failure reason to STDOUT (its `fatal` uses
        // fmt.Printf), so stderr alone is usually empty — surface both, keeping
        // the tail where the actual "❌ Setup failed: …" line lands.
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        let detail: String = stdout
            .lines()
            .chain(stderr.lines())
            .filter(|l| !l.trim().is_empty())
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .take(4)
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(AppError::Other(format!(
            "maestro-ios-device setup failed: {detail}"
        )));
    }

    let dest_str = dest.to_string_lossy().to_string();
    crate::tool_paths::set_maestro_ios_device_path(&dest_str)?;
    info!(path = %dest_str, "maestro-ios-device installed");
    Ok(dest_str)
}

#[tauri::command]
pub async fn run_flow(
    file_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<u32> {
    let device = state
        .connected_device
        .read()
        .clone()
        .ok_or(AppError::NoDevice)?;

    if device.platform == crate::device::Platform::Web {
        // Web flows run with no `--udid`; maestro targets the browser via the
        // flow's `url:` header. Pause the studio keeper so its browser doesn't
        // contend with the one `maestro test` launches.
        teardown_web(state.inner()).await;
        return runner::spawn_web_runner(app, &file_path).await;
    }

    if device.platform == crate::device::Platform::Ios {
        if device.physical {
            // Physical device: the run REUSES the already-running
            // `maestro-ios-device` bridge driver via `--driver-host-port`, so we
            // must NOT tear the keeper down (unlike the simulator path). The
            // HTTP `/screenshot` poller keeps the device mirrored throughout.
            return runner::spawn_ios_device_runner(
                app,
                &device.serial,
                &file_path,
                crate::ios_session::PHYSICAL_BRIDGE_PORT,
            )
            .await;
        }
        // iOS simulator: `maestro --udid <udid> test`. Stop the studio keeper
        // first — it holds the XCTest driver on :22087, which `maestro test`
        // needs to bring up itself; running both contends for the simulator.
        // But KEEP the screenshot poller running: it captures the framebuffer
        // via `simctl` (independent of the :22087 driver), so the simulator
        // stays mirrored in-app throughout the run. The sim stays booted, so
        // re-inspecting afterwards restarts the keeper.
        if let Some(keeper) = state.ios_driver.lock().await.take() {
            keeper.stop().await;
        }
        // Mark the run active so inspector dumps / taps can't re-warm a
        // competing keeper while `maestro test` owns :22087. Cleared by the
        // runner's exit task (or here if the spawn itself fails).
        state
            .ios_sim_run_active
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let spawned = runner::spawn_ios_runner(app, &device.serial, &file_path).await;
        if spawned.is_err() {
            state
                .ios_sim_run_active
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        return spawned;
    }

    let serial = device.serial.clone();

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

    // With maestro 2.5.x, `maestro test` uses an adb-socket
    // (AdbSocketFactory) instead of a host TCP forward, so it cohabits
    // peacefully with our running studio. No cleanup needed.
    runner::spawn_runner(app, &serial, &file_path, None).await
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

/// Extract the first `x.y.z` semver from arbitrary `maestro --version` output.
fn parse_maestro_version(out: &str) -> Option<String> {
    let bytes = out.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            let mut dots = 0;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                if bytes[i] == b'.' {
                    dots += 1;
                }
                i += 1;
            }
            let cand = &out[start..i];
            if dots == 2
                && cand
                    .split('.')
                    .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
            {
                return Some(cand.to_string());
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Status of the physical-iOS prerequisites that can be auto-detected on this Mac.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IosPhysicalSetupStatus {
    /// Full Xcode (not bare Command Line Tools) is selected.
    pub xcode_installed: bool,
    /// Parsed `maestro --version`, or None if maestro isn't resolvable.
    pub maestro_version: Option<String>,
    /// True iff `maestro_version == "2.5.1"`.
    pub maestro_is_2_5_1: bool,
    /// True iff the resolved maestro accepts `--driver-host-port` (patched).
    pub maestro_patched: bool,
}

/// Report the auto-detectable physical-iOS prerequisites for the in-app checklist.
#[tauri::command]
pub async fn ios_physical_setup_status() -> AppResult<IosPhysicalSetupStatus> {
    // Xcode: `xcode-select -p` resolves inside an .app (full Xcode), not /Library/.../CommandLineTools.
    let xcode_installed = tokio::process::Command::new("xcode-select")
        .arg("-p")
        .output()
        .await
        .map(|o| {
            o.status.success()
                && String::from_utf8_lossy(&o.stdout).contains(".app/Contents/Developer")
        })
        .unwrap_or(false);

    let bin = crate::tool_paths::maestro_bin();

    let maestro_version = tokio::process::Command::new(&bin)
        .arg("--version")
        .output()
        .await
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let text = format!(
                "{}{}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            );
            parse_maestro_version(&text)
        });

    let maestro_is_2_5_1 = maestro_version.as_deref() == Some("2.5.1");
    let maestro_patched = crate::runner::maestro_supports_driver_host_port(&bin).await;

    Ok(IosPhysicalSetupStatus {
        xcode_installed,
        maestro_version,
        maestro_is_2_5_1,
        maestro_patched,
    })
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

#[cfg(test)]
mod ios_setup_status_tests {
    use super::parse_maestro_version;

    #[test]
    fn parses_plain_semver() {
        assert_eq!(parse_maestro_version("2.5.1"), Some("2.5.1".to_string()));
    }

    #[test]
    fn parses_semver_embedded_in_noise() {
        assert_eq!(
            parse_maestro_version("Maestro CLI 2.5.1\nsome banner"),
            Some("2.5.1".to_string())
        );
    }

    #[test]
    fn returns_none_when_absent() {
        assert_eq!(parse_maestro_version("no version here"), None);
    }
}
