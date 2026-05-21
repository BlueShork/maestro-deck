// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Tauri command handlers exposed to the frontend. Agent expands (plan §3 Flux 1-5).

pub mod commands;

use tauri::App;

pub fn register_events(_app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}
