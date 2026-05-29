// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Maestro Deck — source-available visual IDE for Maestro mobile tests.

pub mod credentials;
pub mod device;
mod env_shim;
pub mod error;
pub mod hierarchy;
pub mod input;
pub mod ios_session;
pub mod ipc;
pub mod maestro_health;
pub mod metrics;
pub mod process_ext;
pub mod runner;
pub mod scrcpy;
pub mod selector;
pub mod state;
pub mod tool_paths;
pub mod vertex;
pub mod video;
pub mod workspace;
pub mod yaml;

use tracing_subscriber::{fmt, EnvFilter};

use credentials::{delete_credential, get_credential, save_credential};
use ipc::commands::*;
use tool_paths::{get_tool_paths, set_tool_paths};
use vertex::vertex_get_access_token;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,maestro_deck_lib=debug"));
    fmt().with_env_filter(filter).with_target(false).init();

    tracing::info!("Maestro Deck v{} starting", env!("CARGO_PKG_VERSION"));

    // GUI-launched .app bundles on macOS get a minimal PATH that doesn't
    // include adb / maestro / java. Inherit the user's shell env before we
    // expose any subprocess command.
    env_shim::enrich_from_login_shell();

    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .manage(state::AppState::default())
        .invoke_handler(tauri::generate_handler![
            ping,
            app_version,
            list_devices,
            connect_device,
            disconnect_device,
            check_device_health,
            kill_maestro_processes,
            enter_inspect_mode,
            query_element,
            suggest_selectors,
            generate_command,
            send_input,
            set_dark_mode,
            get_dark_mode,
            run_flow,
            stop_flow,
            list_workspace,
            start_metrics,
            stop_metrics,
            start_stream,
            stop_stream,
            vertex_get_access_token,
            save_credential,
            get_credential,
            delete_credential,
            get_tool_paths,
            set_tool_paths,
        ])
        .setup(|app| {
            ipc::register_events(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
