use parking_lot::RwLock;
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::device::Device;
use crate::hierarchy::HierarchyTree;
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
}
