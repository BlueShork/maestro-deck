//! Tauri #[command] handlers. Filled in by the backend agent.
use crate::device::{adb, Device};
use crate::error::AppResult;
use crate::hierarchy::{HierarchyTree, UINode};
use crate::input::{self, InputEvent};
use crate::runner;
use crate::selector::{self, Selector};
use crate::yaml::{self, MaestroAction};

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
pub fn connect_device(_serial: String) -> AppResult<()> {
    Ok(())
}

#[tauri::command]
pub fn disconnect_device() -> AppResult<()> {
    Ok(())
}

#[tauri::command]
pub fn enter_inspect_mode() -> AppResult<HierarchyTree> {
    let tree = HierarchyTree::default();
    Ok(tree)
}

#[tauri::command]
pub fn query_element(_x: i32, _y: i32) -> AppResult<Option<UINode>> {
    Ok(None)
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
pub fn send_input(event: InputEvent) -> AppResult<()> {
    input::send(&event)
}

#[tauri::command]
pub fn run_flow(_file_path: String) -> AppResult<u32> {
    runner::spawn_runner(&_file_path)
}

#[tauri::command]
pub fn stop_flow(pid: u32) -> AppResult<()> {
    runner::kill_runner(pid)
}

// HierarchyTree isn't Serialize yet — agent fills this in
impl serde::Serialize for HierarchyTree {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut st = s.serialize_struct("HierarchyTree", 2)?;
        st.serialize_field("root", &self.root)?;
        st.serialize_field("xml_raw", &self.xml_raw)?;
        st.end()
    }
}
