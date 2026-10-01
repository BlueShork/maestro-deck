// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Device-farm sessions: a phone plugged into the farm, driven through the
//! public gateway as if it were a local Android device.

pub mod bundle;
pub mod commands;
pub mod frames;
pub mod session;

use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};

use crate::state::AppState;

/// The active farm session, if the connected device is a farm phone.
pub async fn active(state: &AppState) -> Option<Arc<session::FarmSession>> {
    state.farm_session.lock().await.clone()
}

/// Drops a farm session that has ended (gateway close, lost link) from the
/// app state, so local commands stop routing to it.
pub async fn clear_if_closed(state: &AppState) {
    let mut slot = state.farm_session.lock().await;
    if !slot.as_ref().is_some_and(|s| s.is_closed()) {
        return;
    }
    *slot = None;
    *state.control_tx.lock().await = None;
    *state.connected_device.write() = None;
    *state.last_hierarchy.write() = None;
    *state.spatial_index.write() = None;
}

/// Production `FarmEvents`: Tauri events, and the runner's own events for runs
/// so the console and step tracking see a farm run like a local one.
pub struct AppFarmEvents(pub AppHandle);

impl session::FarmEvents for AppFarmEvents {
    fn session(&self, event: session::SessionEvent) {
        if matches!(event, session::SessionEvent::Closing { .. }) {
            let app = self.0.clone();
            tokio::spawn(async move {
                clear_if_closed(app.state::<AppState>().inner()).await;
            });
        }
        let _ = self.0.emit("farm://session", &event);
    }
    fn run_line(&self, _pid: u32, line: &str) {
        crate::runner::emit_stdout(&self.0, line);
    }
    fn run_exit(&self, pid: u32, code: Option<i32>) {
        let app = self.0.clone();
        tokio::spawn(async move {
            crate::runner::unregister_runner(pid).await;
            crate::runner::emit_exit(&app, pid, code);
        });
    }
}
