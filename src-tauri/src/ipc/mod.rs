//! Tauri command handlers exposed to the frontend. Agent expands (plan §3 Flux 1-5).

pub mod commands;

use tauri::App;

pub fn register_events(_app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
