// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

use parking_lot::RwLock;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::device::Device;
use crate::hierarchy::driver_keeper::DriverKeeper;
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

    // Background `maestro mcp` process that keeps the on-device
    // gRPC driver alive for the fast-hierarchy path. Lazily spawned
    // on the first fast-mode inspect request and torn down when the
    // device disconnects (see `commands::disconnect_device`).
    pub driver_keeper: AsyncMutex<Option<Arc<DriverKeeper>>>,

    pub ios_driver: AsyncMutex<Option<Arc<IosDriverKeeper>>>,
    pub ios_screenshot_abort: AsyncMutex<Option<oneshot::Sender<()>>>,
    /// True while a hierarchy dump (inspect) is holding the iOS driver bridge.
    /// The physical-device screenshot mirror polls `/screenshot` on the single
    /// :22087 forward every 50 ms; left running during a dump it starves
    /// `/status` + `/hierarchy` and inspect hangs. The poller pauses while set.
    pub ios_inspect_active: std::sync::atomic::AtomicBool,
    /// True while a `maestro test` run is in flight on an iOS **simulator**.
    /// The simulator driver (`maestro mcp` keeper, runner on :22087) and `maestro test`
    /// can't coexist, so the run stops the keeper first — this flag then blocks
    /// `ensure_ios_keeper` from re-warming a competing keeper (inspector dumps,
    /// taps) until the run exits, which would otherwise deadlock both on :22087.
    pub ios_sim_run_active: std::sync::atomic::AtomicBool,
    #[cfg(target_os = "macos")]
    pub ios_preview_session: AsyncMutex<Option<crate::ios_session::PreviewHandle>>,

    pub web_driver: AsyncMutex<Option<Arc<crate::web_session::WebDriverKeeper>>>,
    pub web_screenshot_abort: AsyncMutex<Option<oneshot::Sender<()>>>,
    /// True while a `maestro -p web test` run is in flight. The web keeper's
    /// browser and the test's own browser can't coexist, so `run_flow` stops the
    /// keeper first — this flag then blocks `ensure_web_keeper` from re-spawning
    /// a competing one (inspect, taps) until the run exits. Mirror of
    /// `ios_sim_run_active`.
    pub web_run_active: std::sync::atomic::AtomicBool,
    /// Consecutive `WebDriverKeeper::start` failures — drives the exponential
    /// respawn backoff (1 s / 2 s / 4 s) in `ensure_web_keeper`, reset on success.
    pub web_respawn_fails: std::sync::atomic::AtomicU32,
    /// Last real page URL seen in the web session (from the preview's CDP
    /// target; never a blank/`data:` tab). Survives keeper teardown so a
    /// respawn — after a run, or after a transient driver failure — restores
    /// the user's page instead of a blank tab.
    pub web_last_url: RwLock<Option<String>>,
    /// Abort handle of the CDP run mirror (live view of a headless web run).
    /// Fired by the runner's exit task — or by teardown if the user
    /// disconnects mid-run.
    pub web_run_mirror_abort: AsyncMutex<Option<oneshot::Sender<()>>>,

    /// Set once the user has confirmed quitting (or opted out of the prompt).
    /// The window-close / app-exit handlers prevent the first quit to show the
    /// confirmation dialog; `confirm_quit` flips this so the second exit — the
    /// one it triggers after cleanup — is allowed through.
    pub quit_confirmed: std::sync::atomic::AtomicBool,
}
