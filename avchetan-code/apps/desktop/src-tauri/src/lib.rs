//! Thin native shell (docs/architecture/desktop.md): windows, hotkeys, tray, clipboard, keychain and
//! SQLite access. All app logic lives in TypeScript in the webviews.

mod app_lock;
mod clipboard;
mod commands;
mod context;
mod dock_look;
mod error;
mod hotkey;
mod notify;
mod tray;
mod voice;
mod windows;

use tauri::{Manager, RunEvent};
use tauri_plugin_autostart::MacosLauncher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second launch exits before doing anything else.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            windows::show_dock(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&[windows::DOCK])
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(hotkey::plugin())
        .setup(|app| {
            // Before anything reads a secret, such as the hub's token at start.
            commands::secrets::use_service(&app.config().identifier);
            let data_dir = app.path().app_data_dir()?;
            app.manage(commands::db::DbState::new(data_dir.join("avchetan.db")));
            let hub = commands::hub::HubState::load(data_dir.join("hub"));
            hub.start_if_enabled();
            app.manage(hub);
            app.manage(voice::VoiceState::new(&data_dir));
            app.manage(app_lock::LockState::default());
            app_lock::watch_session(app.handle());
            app.manage(hotkey::HotkeyState::default());
            app.manage(hotkey::HoldState::default());
            hotkey::register_default(app.handle());
            tray::create(app)?;
            let backdrop = app
                .get_webview_window(windows::DOCK)
                .map_or(dock_look::Backdrop::None, |dock| dock_look::apply(&dock));
            app.manage(dock_look::LookState(backdrop));
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
            app_lock::lock_status,
            app_lock::lock_configure,
            app_lock::lock_available,
            app_lock::lock_unlock,
            app_lock::lock_now,
            commands::data::backup_create,
            commands::data::backup_list,
            commands::data::data_folder_open,
            commands::data::export_write,
            commands::db::db_open,
            commands::db::db_run,
            commands::db::db_values,
            commands::db::db_batch,
            commands::db::db_rollback,
            commands::hub::hub_status,
            commands::hub::hub_configure,
            commands::hub::hub_import_data,
            commands::hub::hub_backup_list,
            commands::hub::hub_restore,
            commands::hub::hub_folder_open,
            commands::hub::hub_free_port,
            commands::network::hub_network_status,
            commands::network::hub_network_allow,
            commands::network::network_settings_open,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            windows::dock_hide,
            dock_look::dock_look,
            dock_look::dock_fit,
            windows::main_open,
            hotkey::hotkey_status,
            hotkey::hotkey_set,
            hotkey::snap_hotkey_status,
            hotkey::snap_hotkey_set,
            tray::tray_set_pending,
            tray::tray_set_context,
            context::context_recent_apps,
            notify::brief_notify,
            voice::voice_start,
            voice::voice_stop,
            voice::voice_cancel,
            voice::voice_devices,
            voice::voice_model_status,
            voice::voice_model_delete,
            voice::voice_model_download,
            voice::voice_model_download_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Avchetan")
        .run(|app, event| {
            // Closing the hub's stdin stops it cleanly; it would also stop if this process died.
            if let RunEvent::Exit = event {
                app.state::<commands::hub::HubState>().stop();
            }
        });
}
