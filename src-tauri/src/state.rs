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
    #[cfg(target_os = "macos")]
    pub ios_sck_session: AsyncMutex<Option<crate::ios_session::PreviewHandle>>,

    pub web_driver: AsyncMutex<Option<Arc<crate::web_session::WebStudioKeeper>>>,
    pub web_screenshot_abort: AsyncMutex<Option<oneshot::Sender<()>>>,
}
