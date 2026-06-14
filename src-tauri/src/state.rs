// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use parking_lot::RwLock;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::device::Device;
use crate::hierarchy::studio::StudioKeeper;
use crate::hierarchy::HierarchyTree;
use crate::ios_session::IosDriverKeeper;
use crate::selector::SpatialIndex;

#[derive(Default)]
pub struct AppState {
    pub adb_path: RwLock<Option<String>>,
    pub maestro_path: RwLock<Option<String>>,
    pub connected_device: RwLock<Option<Device>>,
    pub last_hierarchy: RwLock<Option<Arc<HierarchyTree>>>,
    pub spatial_index: RwLock<Option<Arc<SpatialIndex>>>,

    // Per-session scrcpy state.
    pub scid: RwLock<Option<String>>,
    pub control_tx: AsyncMutex<Option<mpsc::Sender<Vec<u8>>>>,
    pub stream_abort: AsyncMutex<Option<oneshot::Sender<()>>>,
    pub scrcpy_child: AsyncMutex<Option<tokio::process::Child>>,

    // Background `maestro studio` process that keeps the on-device
    // gRPC driver alive for the fast-hierarchy path. Lazily spawned
    // on the first fast-mode inspect request and torn down when the
    // device disconnects (see `commands::disconnect_device`).
    pub studio: AsyncMutex<Option<Arc<StudioKeeper>>>,

    pub ios_driver: AsyncMutex<Option<Arc<IosDriverKeeper>>>,
    pub ios_screenshot_abort: AsyncMutex<Option<oneshot::Sender<()>>>,
    /// True while a `maestro test` run is in flight on an iOS **simulator**.
    /// The simulator driver (`maestro studio` on :22087) and `maestro test`
    /// can't coexist, so the run stops the keeper first — this flag then blocks
    /// `ensure_ios_keeper` from re-warming a competing keeper (inspector dumps,
    /// taps) until the run exits, which would otherwise deadlock both on :22087.
    pub ios_sim_run_active: std::sync::atomic::AtomicBool,
    #[cfg(target_os = "macos")]
    pub ios_preview_session: AsyncMutex<Option<crate::ios_session::PreviewHandle>>,

    pub web_driver: AsyncMutex<Option<Arc<crate::web_session::WebStudioKeeper>>>,
    pub web_screenshot_abort: AsyncMutex<Option<oneshot::Sender<()>>>,

    /// Set once the user has confirmed quitting (or opted out of the prompt).
    /// The window-close / app-exit handlers prevent the first quit to show the
    /// confirmation dialog; `confirm_quit` flips this so the second exit — the
    /// one it triggers after cleanup — is allowed through.
    pub quit_confirmed: std::sync::atomic::AtomicBool,
}
