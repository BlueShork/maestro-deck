//! Tauri #[command] handlers.

use std::sync::Arc;

use tauri::{AppHandle, State};
use tokio::sync::mpsc;
use tracing::{info, warn};

use crate::device::{adb, Device};
use crate::error::{AppError, AppResult};
use crate::hierarchy::{self, HierarchyTree, UINode};
use crate::input::{self, InputEvent};
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
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let device = adb::get_device_info(&serial)?;
    info!(serial = %serial, model = %device.model, "device connected");
    *state.connected_device.write() = Some(device);

    // Defensive cleanup: any leftover scrcpy server from a previous run holds
    // the abstract socket name and would block start_server with EADDRINUSE.
    teardown_scrcpy(&serial, state.inner()).await;

    if let Err(e) = scrcpy::push_server(&serial) {
        warn!(error = ?e, "scrcpy push_server failed");
        return Ok(());
    }

    let scid = scrcpy::random_scid();
    *state.scid.write() = Some(scid.clone());

    if let Err(e) = scrcpy::create_tunnel(&serial, scrcpy::DEFAULT_PORT, &scid) {
        warn!(error = ?e, "scrcpy create_tunnel failed");
        return Ok(());
    }

    let child = match scrcpy::spawn_server(&serial, &scid) {
        Ok(c) => c,
        Err(e) => {
            warn!(error = ?e, "scrcpy spawn_server failed");
            return Ok(());
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

    Ok(())
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
pub fn enter_inspect_mode(state: State<'_, AppState>) -> AppResult<HierarchyTree> {
    let serial = state
        .connected_device
        .read()
        .as_ref()
        .map(|d| d.serial.clone())
        .ok_or(AppError::NoDevice)?;

    let tree = hierarchy::dump_hierarchy(&serial)?;
    let tree_arc = Arc::new(tree.clone());
    *state.last_hierarchy.write() = Some(tree_arc);

    if let Some(root) = tree.root.as_ref() {
        let idx = SpatialIndex::build(root);
        *state.spatial_index.write() = Some(Arc::new(idx));
    } else {
        *state.spatial_index.write() = None;
    }

    Ok(tree)
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
pub async fn send_input(event: InputEvent, state: State<'_, AppState>) -> AppResult<()> {
    let (w, h) = {
        let guard = state.connected_device.read();
        let dev = guard.as_ref().ok_or(AppError::NoDevice)?;
        (dev.screen_width as u16, dev.screen_height as u16)
    };
    input::send(&event, state.inner(), w, h).await
}

#[tauri::command]
pub async fn run_flow(file_path: String, app: AppHandle) -> AppResult<u32> {
    runner::spawn_runner(app, &file_path).await
}

#[tauri::command]
pub async fn stop_flow(pid: u32) -> AppResult<()> {
    runner::kill_runner(pid).await
}

#[tauri::command]
pub fn list_workspace(path: String) -> AppResult<WorkspaceNode> {
    workspace::list_workspace(std::path::Path::new(&path))
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
