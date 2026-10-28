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
            app.manage(watching::Watches::new(app.handle().clone()).map_err(std::io::Error::other)?);
            tauri::WebviewWindowBuilder::from_config(app, &app.config().app.windows[0])?
                .on_navigation(local_navigation).build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                window.state::<watching::Watches>().remove_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![new_workspace, files::open_file, files::read_file,
            files::save_file, files::check_file, recovery::write_snapshot, recovery::remove_snapshot,
            recovery::clear_snapshots, recovery::list_recovery, recovery::discard_recovery,
            recovery::get_modifier, recovery::set_modifier, watching::watch_document])
        .run(tauri::generate_context!())
        .expect("failed to run Tessera");
}
mod files;
mod recovery;
mod watching;
use tauri::Manager;

fn local_navigation(url: &tauri::Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        || (cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("localhost") && url.port() == Some(1420))
}

