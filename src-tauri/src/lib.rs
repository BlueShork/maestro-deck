// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Maestro Deck — source-available visual IDE for Maestro mobile tests.

pub mod credentials;
pub mod device;
mod env_shim;
pub mod error;
pub mod hierarchy;
pub mod input;
#[cfg(target_os = "macos")]
pub mod ios_capture;
pub mod ios_session;
pub mod ipc;
pub mod maestro_health;
pub mod metrics;
pub mod process_ext;
pub mod runner;
pub mod scrcpy;
pub mod selector;
#[cfg(target_os = "macos")]
pub mod sim_capture;
pub mod state;
pub mod tool_paths;
pub mod vertex;
pub mod video;
mod web_session;
pub mod workspace;
pub mod yaml;

use tauri::{Emitter, Manager};
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
            confirm_quit,
            check_device_health,
            kill_maestro_processes,
            enter_inspect_mode,
            query_element,
            suggest_selectors,
            generate_command,
            send_input,
            ios_press_home,
            ios_device_bridge_installed,
            install_ios_device_bridge,
            set_dark_mode,
            get_dark_mode,
            run_flow,
            stop_flow,
            list_workspace,
            start_metrics,
            stop_metrics,
            start_stream,
            stop_stream,
            upgrade_ios_preview,
            vertex_get_access_token,
            save_credential,
            get_credential,
            delete_credential,
            get_tool_paths,
            set_tool_paths,
        ])
        .setup(|app| {
            ipc::register_events(app)?;
            // The static `maximized` window flag is unreliable (notably on macOS),
            // so maximize explicitly once the window exists.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }
            // macOS only: the default app menu's "Quit" (Cmd+Q) calls AppKit
            // `terminate:`, which hard-exits WITHOUT a preventable
            // `RunEvent::ExitRequested` — so the confirm dialog never gets a
            // chance. Replace the menu with one whose Quit is a plain item that
            // emits `quit-requested` instead of terminating; the rest mirrors
            // the macOS defaults (predefined items keep their native behaviour,
            // so editor copy/paste/undo still work). Windows/Linux have no app
            // menu and quit via the window close path (handled below).
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{AboutMetadata, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
                let h = app.handle();
                let quit = MenuItemBuilder::new("Quit Maestro Deck")
                    .id("quit")
                    .accelerator("Cmd+Q")
                    .build(h)?;
                let app_menu = SubmenuBuilder::new(h, "Maestro Deck")
                    .about(Some(AboutMetadata::default()))
                    .separator()
                    .services()
                    .separator()
                    .hide()
                    .hide_others()
                    .show_all()
                    .separator()
                    .item(&quit)
                    .build()?;
                let edit_menu = SubmenuBuilder::new(h, "Edit")
                    .undo()
                    .redo()
                    .separator()
                    .cut()
                    .copy()
                    .paste()
                    .select_all()
                    .build()?;
                let window_menu = SubmenuBuilder::new(h, "Window")
                    .minimize()
                    .maximize()
                    .separator()
                    .fullscreen()
                    .close_window()
                    .build()?;
                let menu = MenuBuilder::new(h)
                    .item(&app_menu)
                    .item(&edit_menu)
                    .item(&window_menu)
                    .build()?;
                app.set_menu(menu)?;
                let quit_id = quit.id().clone();
                app.on_menu_event(move |app, event| {
                    if event.id() == &quit_id {
                        let _ = app.emit("quit-requested", ());
                    }
                });
            }
            Ok(())
        })
        // Intercept the window close button (and Windows close): hold the close
        // and ask the frontend to confirm. `confirm_quit` flips `quit_confirmed`
        // and triggers the real exit once the user agrees.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<state::AppState>();
                if !state.quit_confirmed.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.emit("quit-requested", ());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        // Intercept app-level quit (macOS Cmd+Q): same confirm-then-cleanup path
        // as the window close button.
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                let state = app_handle.state::<state::AppState>();
                if !state.quit_confirmed.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app_handle.emit("quit-requested", ());
                }
            }
        });
}
