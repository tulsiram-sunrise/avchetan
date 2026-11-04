//! Thin native shell (docs/architecture/desktop.md): windows, hotkey, tray, keychain and
//! SQLite access. All app logic lives in TypeScript in the webviews.

mod commands;
mod error;
mod hotkey;
mod tray;
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
            let data_dir = app.path().app_data_dir()?;
            app.manage(commands::db::DbState::new(data_dir.join("avchetan.db")));
            let hub = commands::hub::HubState::load(data_dir.join("hub"));
            hub.start_if_enabled();
            app.manage(hub);
            app.manage(hotkey::HotkeyState::default());
            hotkey::register_default(app.handle());
            tray::create(app)?;
            Ok(())
        })
        .on_window_event(windows::on_window_event)
        .invoke_handler(tauri::generate_handler![
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
            commands::network::hub_network_status,
            commands::network::hub_network_allow,
            commands::network::network_settings_open,
            commands::secrets::secret_get,
            commands::secrets::secret_set,
            commands::secrets::secret_delete,
            windows::dock_hide,
            windows::main_open,
            hotkey::hotkey_status,
            hotkey::hotkey_set,
            tray::tray_set_pending,
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
