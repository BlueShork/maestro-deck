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

    // Best-effort: push the scrcpy server and open the tunnel. Failures are
    // logged but don't fail the connect call — the inspector still works
    // without streaming.
    if let Err(e) = scrcpy::push_server(&serial) {
        warn!(error = ?e, "scrcpy push_server failed");
        return Ok(());
    }
    if let Err(e) = scrcpy::create_tunnel(&serial, scrcpy::DEFAULT_PORT) {
        warn!(error = ?e, "scrcpy create_tunnel failed");
        return Ok(());
    }
    if let Err(e) = scrcpy::start_server(&serial) {
        warn!(error = ?e, "scrcpy start_server failed");
        return Ok(());
    }

    // Spawn video stream first (it gets the device meta header), then control.
    match scrcpy::stream::spawn_stream(app, scrcpy::DEFAULT_PORT).await {
        Ok(handle) => {
            *state.stream_abort.lock().await = Some(handle.abort);
        }
        Err(e) => {
            warn!(error = ?e, "scrcpy stream connection failed");
            return Ok(());
        }
    }

    let (tx, rx) = mpsc::channel::<Vec<u8>>(CONTROL_CHANNEL_DEPTH);
    match scrcpy::stream::spawn_control(scrcpy::DEFAULT_PORT, rx).await {
        Ok(()) => {
            *state.control_tx.lock().await = Some(tx);
        }
        Err(e) => {
            warn!(error = ?e, "scrcpy control connection failed");
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn disconnect_device(state: State<'_, AppState>) -> AppResult<()> {
    *state.connected_device.write() = None;
    *state.last_hierarchy.write() = None;
    *state.spatial_index.write() = None;
    // Drop the control channel sender — the writer task exits when rx returns None.
    *state.control_tx.lock().await = None;
    // Send the abort signal to the video read loop.
    if let Some(abort) = state.stream_abort.lock().await.take() {
        let _ = abort.send(());
    }
    Ok(())
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
pub fn run_flow(file_path: String) -> AppResult<u32> {
    runner::spawn_runner(&file_path)
}

#[tauri::command]
pub fn stop_flow(pid: u32) -> AppResult<()> {
    runner::kill_runner(pid)
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
