//! LFG HQ desktop shell.
//!
//! The shell stays deliberately thin: it owns the window, the tray, native
//! notifications and deep links, and nothing else. All product logic lives in
//! the web layer so the same code serves the desktop app and the PWA.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};

/// Reveal and focus the main window, restoring it if it was minimised.
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Whether the platform reports the app as active. Used by the web layer to
/// decide if a native notification is warranted for an incoming message.
#[tauri::command]
fn window_is_focused(app: AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

/// Bring the window forward from the web layer, e.g. when a notification is
/// clicked.
#[tauri::command]
fn focus_window(app: AppHandle) {
    focus_main_window(&app);
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Open LFG HQ", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("LFG HQ")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Left click restores the window, matching how chat apps behave.
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        // Must be registered first so a second launch hands off to the running
        // instance instead of opening a duplicate window.
        builder = builder
            .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
                focus_main_window(app);
            }))
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_deep_link::init());
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![window_is_focused, focus_window])
        .setup(|app| {
            #[cfg(desktop)]
            build_tray(app.handle())?;

            // The window is created hidden and shown once the webview has
            // painted, which avoids a white flash on a dark-first UI.
            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides it to the tray; quitting is explicit,
            // so realtime subscriptions and unread state survive a stray close.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running LFG HQ");
}
