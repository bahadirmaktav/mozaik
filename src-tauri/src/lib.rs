mod directory;
mod files;
mod operations;
mod pins;
mod recovery;
mod terminal;
mod watching;
use tauri::Manager;

#[tauri::command]
fn new_workspace(app: tauri::AppHandle) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(
        &app,
        format!("workspace-{}", uuid::Uuid::new_v4()),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Tessera")
    .inner_size(1100.0, 760.0)
    .min_inner_size(420.0, 320.0)
    .decorations(false)
    .on_navigation(local_navigation)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let storage = recovery::Storage::new(app.path().app_data_dir()?.join("recovery"))
                .map_err(std::io::Error::other)?;
            app.manage(storage);
            app.manage(
                watching::Watches::new(app.handle().clone()).map_err(std::io::Error::other)?,
            );
            app.manage(terminal::TerminalSessions::default());
            app.manage(operations::Operations::default());
            app.manage(pins::storage(app.handle()).map_err(std::io::Error::other)?);
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(local_navigation)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window
                    .state::<watching::Watches>()
                    .remove_window(window.label());
                window
                    .state::<terminal::TerminalSessions>()
                    .close_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            new_workspace,
            files::open_file,
            files::read_file,
            files::save_file,
            files::check_file,
            recovery::write_snapshot,
            recovery::remove_snapshot,
            recovery::clear_snapshots,
            recovery::list_recovery,
            recovery::discard_recovery,
            recovery::get_modifier,
            recovery::set_modifier,
            watching::watch_document,
            watching::watch_directory,
            directory::read_directory,
            directory::create_entry,
            directory::rename_entry,
            directory::open_entry,
            directory::file_manager_settings,
            directory::set_show_hidden,
            operations::plan_transfer,
            operations::transfer_entries,
            operations::cancel_operation,
            operations::trash_entries,
            operations::delete_permanently,
            pins::pins_list,
            pins::pins_add,
            pins::pins_remove,
            pins::pins_reorder,
            terminal::terminal_shells,
            terminal::set_default_shell,
            terminal::create_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::ack_terminal,
            terminal::close_terminal
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Tessera")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<terminal::TerminalSessions>().close_all();
            }
        });
}
fn local_navigation(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions)
            && url.scheme() == "http"
            && url.host_str() == Some("localhost")
            && url.port() == Some(1420))
}
