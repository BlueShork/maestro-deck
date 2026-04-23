use parking_lot::RwLock;
use std::sync::Arc;

use crate::device::Device;
use crate::hierarchy::HierarchyTree;

#[derive(Default)]
pub struct AppState {
    pub adb_path: RwLock<Option<String>>,
    pub maestro_path: RwLock<Option<String>>,
    pub connected_device: RwLock<Option<Device>>,
    pub last_hierarchy: RwLock<Option<Arc<HierarchyTree>>>,
}
