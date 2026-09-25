//! Native macOS menu bar.
//!
//! Predefined items (Edit, Window, Hide…) keep their native AppKit behaviour.
//! Every app-specific item is a plain item whose click is forwarded to the
//! frontend as a `menu:action` event carrying the item id — the webview owns
//! the logic, so a menu click and the matching toolbar button run the same
//! code. Check items (panels, inspect, AI assistant) mirror frontend state:
//! the frontend pushes their state through `set_menu_checked`.
//!
//! Quit is special: the default "Quit" calls AppKit `terminate:`, which
//! hard-exits WITHOUT a preventable `RunEvent::ExitRequested`, so the confirm
//! dialog would never get a chance. Ours emits `quit-requested` instead.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::CheckMenuItem;
use tauri::{AppHandle, Wry};

/// Check items by id, so `set_menu_checked` can reach them.
#[derive(Default)]
pub struct MenuChecks(Mutex<HashMap<String, CheckMenuItem<Wry>>>);

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{
        AboutMetadata, CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder,
    };
    use tauri::{Emitter, Manager};

    let h = app.handle();
    let item = |id: &str, text: &str, accel: Option<&str>| {
        let mut b = MenuItemBuilder::new(text).id(id);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(h)
    };
    let mut checks: HashMap<String, CheckMenuItem<Wry>> = HashMap::new();
    let mut check = |id: &str, text: &str| -> tauri::Result<CheckMenuItem<Wry>> {
        let c = CheckMenuItemBuilder::new(text).id(id).build(h)?;
        checks.insert(id.to_string(), c.clone());
        Ok(c)
    };

    let app_menu = SubmenuBuilder::new(h, "Maestro Deck")
        .about(Some(AboutMetadata::default()))
        .item(&item("check-updates", "Check for Updates…", None)?)
        .separator()
        .item(&item("settings", "Settings…", Some("Cmd+,"))?)
        .item(&item("account", "Maestro Deck Cloud Account…", None)?)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&item("quit", "Quit Maestro Deck", Some("Cmd+Q"))?)
        .build()?;
    let file_menu = SubmenuBuilder::new(h, "File")
        .item(&item("open-folder", "Open Folder…", Some("Cmd+O"))?)
        .item(&item("open-file", "Open Flow…", Some("Cmd+Shift+O"))?)
        .separator()
        .item(&item("save", "Save", Some("Cmd+S"))?)
        .item(&item("save-as", "Save As…", Some("Cmd+Shift+S"))?)
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
    // Inspect has no accelerator: its shortcut is a bare, user-configurable
    // letter, which as a menu key equivalent would eat typing in the editor.
    let run_menu = SubmenuBuilder::new(h, "Run")
        .item(&item("run", "Run Flow", Some("Cmd+R"))?)
        .item(&item("run-all", "Run All Flows", Some("Cmd+Shift+R"))?)
        .item(&item("stop", "Stop", Some("Cmd+."))?)
        .separator()
        .item(&check("inspect", "Inspect Mode")?)
        .build()?;
    let view_menu = SubmenuBuilder::new(h, "View")
        .item(&check("panel:workspace", "Workspace")?)
        .item(&check("panel:inspector", "Inspector")?)
        .item(&check("panel:device", "Device")?)
        .item(&check("panel:editor", "Editor")?)
        .item(&check("panel:console", "Run Console")?)
        .separator()
        .item(&item("show-all-panels", "Show All Panels", None)?)
        .separator()
        .item(&check("ai-assistant", "AI Assistant")?)
        .item(&item("image-bank", "Image Bank", None)?)
        .separator()
        .fullscreen()
        .build()?;
    let window_menu = SubmenuBuilder::new(h, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;
    let help_menu = SubmenuBuilder::new(h, "Help")
        .item(&item("docs", "Maestro Deck Documentation", None)?)
        .build()?;

    let menu = MenuBuilder::new(h)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &run_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;
    app.set_menu(menu)?;
    *app.state::<MenuChecks>().0.lock().unwrap() = checks;

    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if id == "quit" {
            let _ = app.emit("quit-requested", ());
        } else {
            let _ = app.emit("menu:action", id);
        }
    });
    Ok(())
}

/// Sets a check item's tick. Unknown ids (and every id off macOS, where there
/// is no menu) are ignored, so the frontend can call this unconditionally.
#[tauri::command]
pub fn set_menu_checked(app: AppHandle, id: String, checked: bool) {
    use tauri::Manager;
    let checks = app.state::<MenuChecks>();
    let map = checks.0.lock().unwrap();
    if let Some(item) = map.get(&id) {
        let _ = item.set_checked(checked);
    }
}
