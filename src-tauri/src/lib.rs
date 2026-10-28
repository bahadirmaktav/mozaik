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
    .on_navigation(|url| matches!(url.host_str(), Some("tauri.localhost" | "localhost")) || url.scheme() == "tauri")
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![new_workspace])
        .run(tauri::generate_context!())
        .expect("failed to run Tessera");
}
