// Copyright (c) 2026 Ethan Morisset
// SPDX-License-Identifier: BUSL-1.1

//! Maestro Deck — source-available visual IDE for Maestro mobile tests.

pub mod app_control;
mod app_menu;
#[cfg(target_os = "macos")]
pub mod avf_capture;
pub mod bank;
pub mod cloud;
pub mod credentials;
pub mod device;
mod env_check;
mod env_shim;
pub mod error;
pub mod farm;
pub mod hierarchy;
pub mod input;
#[cfg(target_os = "macos")]
pub mod ios_capture;
pub mod ios_session;
pub mod ipc;
pub mod maestro_health;
pub mod maestro_mcp;
pub mod metrics;
pub mod onboarding;
pub mod plugins;
pub mod process_ext;
pub mod prockill;
pub mod runner;
pub mod scrcpy;
pub mod selector;
#[cfg(target_os = "macos")]
pub mod sim_capture;
pub mod state;
pub mod tool_paths;
pub mod tool_setup;
pub mod vertex;
pub mod video;
mod web_session;
pub mod workspace;
pub mod workspace_fs;
pub mod yaml;

use tauri::{Emitter, Manager};
use tracing_subscriber::{fmt, EnvFilter};

use app_control::{launch_app, stop_app};
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
    // After the login shell, so a JDK we installed wins over an older system
    // one — we only ever install when the machine's own Java was rejected.
    tool_setup::install::apply_managed_java_env();

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
        .manage(app_menu::MenuChecks::default())
        .manage(plugins::commands::WorkspaceAllow::default())
        .register_asynchronous_uri_scheme_protocol("mdplugin", |_ctx, request, responder| {
            let path = request.uri().path().to_string();
            std::thread::spawn(move || responder.respond(plugins::protocol::respond(&path)));
        })
        .invoke_handler(tauri::generate_handler![
            ping,
            app_menu::set_menu_checked,
            app_version,
            list_devices,
            connect_device,
            farm::commands::connect_farm_device,
            farm::commands::farm_reconnect,
            farm::commands::farm_install_apk,
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
            ios_physical_setup_status,
            set_dark_mode,
            get_dark_mode,
            run_flow,
            stop_flow,
            launch_app,
            stop_app,
            bank::ipc::compare_screenshots,
            bank::ipc::compare_screenshots_all,
            bank::ipc::resolve_comparison,
            bank::ipc::list_bank,
            bank::ipc::load_bank_image,
            bank::ipc::delete_bank_image,
            bank::ipc::delete_bank_device,
            onboarding::install_sample_app,
            onboarding::sample_app_apk,
            tool_setup::install::setup_tools,
            tool_setup::install::managed_tools,
            cloud::cloud_upload_file,
            cloud::cloud_api_request,
            cloud::cloud_download_text,
            workspace_fs::read_workspace_file,
            workspace_fs::write_workspace_file,
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
            plugins::commands::plugins_registry,
            plugins::commands::plugins_list,
            plugins::commands::plugins_install,
            plugins::commands::plugins_uninstall,
            plugins::commands::plugins_load_dev,
            plugins::commands::plugin_http_fetch,
            plugins::commands::plugin_open_external,
            plugins::commands::plugin_secret_get,
            plugins::commands::plugin_secret_set,
            plugins::commands::plugin_secret_delete,
            plugins::commands::plugin_workspace_info,
            plugins::commands::workspace_git_branch,
            plugins::commands::plugin_workspace_changes,
            plugins::commands::plugin_workspace_read,
            plugins::commands::plugin_origin_allowed,
            plugins::commands::plugin_grant_origin,
            plugins::commands::plugin_revoke_origin,
            get_tool_paths,
            set_tool_paths,
            env_check::environment_status,
            env_check::install_tool,
        ])
        .setup(|app| {
            ipc::register_events(app)?;
            // The window is created hidden (`visible: false`): showing it at
            // 1400×900 and maximizing a frame later read as two windows
            // opening. Size it to the screen's work area while hidden, then
            // let the splash page show it once its markup is ready
            // (index.html), with a fallback here if the page never gets there.
            if let Some(window) = app.get_webview_window("main") {
                let monitor = window
                    .current_monitor()
                    .ok()
                    .flatten()
                    .or_else(|| window.primary_monitor().ok().flatten());
                if let Some(monitor) = monitor {
                    let area = monitor.work_area();
                    let _ = window.set_position(area.position);
                    let _ = window.set_size(area.size);
                }
                let fallback = window.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    if !fallback.is_visible().unwrap_or(true) {
                        let _ = fallback.show();
                        let _ = fallback.maximize();
                    }
                });
            }
            // macOS only: native menu bar (see app_menu.rs, including why Quit
            // is a custom item). Windows/Linux have no app menu and quit via
            // the window close path (handled below).
            #[cfg(target_os = "macos")]
            app_menu::install(app)?;
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
