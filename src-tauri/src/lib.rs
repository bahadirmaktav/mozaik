mod analysis;
mod cmake;
mod coverage;
mod debug;
mod directory;
mod drawings;
mod files;
mod git;
mod layouts;
mod lsp;
mod notes;
mod operations;
mod panels;
mod pins;
mod preferences;
mod project;
mod recovery;
mod rename;
mod tasks;
mod terminal;
mod watching;
use tauri::Manager;

// Async: on Windows, building a WebView2 window from a synchronous command deadlocks and
// leaves the new window blank.
#[tauri::command]
async fn new_workspace(app: tauri::AppHandle) -> Result<(), String> {
    tauri::WebviewWindowBuilder::new(
        &app,
        format!("workspace-{}", uuid::Uuid::new_v4()),
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Mozaik")
    .inner_size(1100.0, 760.0)
    .min_inner_size(420.0, 320.0)
    .decorations(false)
    .transparent(true)
    .on_navigation(local_navigation)
    .build()
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            for dir in [app.path().app_config_dir()?, app.path().app_data_dir()?] {
                rename::adopt_previous(&dir)?;
            }
            let storage = recovery::Storage::new(app.path().app_data_dir()?.join("recovery"))
                .map_err(std::io::Error::other)?;
            app.manage(storage);
            files::set_lock_directory(app.path().app_local_data_dir()?.join("locks"));
            app.manage(
                watching::Watches::new(app.handle().clone()).map_err(std::io::Error::other)?,
            );
            app.manage(terminal::TerminalSessions::default());
            app.manage(lsp::LanguageServers::default());
            app.manage(cmake::jobs::Jobs::default());
            app.manage(analysis::Analyses::default());
            app.manage(debug::DebugAdapters::default());
            app.manage(operations::Operations::default());
            app.manage(pins::storage(app.handle()).map_err(std::io::Error::other)?);
            app.manage(tasks::storage(app.handle()).map_err(std::io::Error::other)?);
            app.manage(panels::PanelOwner::default());
            app.manage(drawings::storage(app.handle()).map_err(std::io::Error::other)?);
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
                window
                    .state::<lsp::LanguageServers>()
                    .close_window(window.label());
                window
                    .state::<cmake::jobs::Jobs>()
                    .close_window(window.label());
                window
                    .state::<analysis::Analyses>()
                    .close_window(window.label());
                window
                    .state::<debug::DebugAdapters>()
                    .close_window(window.label());
                window
                    .state::<panels::PanelOwner>()
                    .release_window(window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            new_workspace,
            files::open_file,
            files::choose_folder,
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
            preferences::get_preferences,
            preferences::set_preferences,
            preferences::choose_start_folder,
            layouts::layouts_list,
            layouts::layouts_save,
            layouts::layouts_delete,
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
            tasks::tasks_snapshot,
            tasks::tasks_create_list,
            tasks::tasks_rename_list,
            tasks::tasks_delete_list,
            tasks::tasks_create_task,
            tasks::tasks_update_task,
            tasks::tasks_move_task,
            tasks::tasks_delete_task,
            tasks::tasks_select_list,
            tasks::tasks_claim_panel,
            tasks::tasks_release_panel,
            notes::notes_snapshot,
            notes::notes_read,
            notes::notes_write,
            notes::notes_create,
            notes::notes_create_group,
            notes::notes_rename,
            notes::notes_move,
            notes::notes_trash,
            notes::notes_claim_panel,
            notes::notes_release_panel,
            drawings::drawings_open,
            drawings::drawings_set_open,
            drawings::drawings_take_pending,
            drawings::drawings_close_window,
            drawings::drawings_save,
            drawings::drawings_export,
            drawings::drawings_read_image,
            terminal::terminal_shells,
            terminal::set_default_shell,
            terminal::create_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::ack_terminal,
            terminal::close_terminal,
            project::project_open,
            project::project_files,
            project::project_search,
            project::project_replace_text,
            project::project_replace,
            project::project_set_settings,
            project::project_recent,
            git::git_status,
            git::git_head_text,
            git::git_index_text,
            git::git_stage,
            git::git_unstage,
            git::git_discard,
            lsp::lsp_servers,
            lsp::lsp_choose_server,
            lsp::lsp_reset_server,
            lsp::lsp_start,
            lsp::lsp_send,
            lsp::lsp_stop,
            cmake::cmake_settings,
            cmake::cmake_set_settings,
            cmake::cmake_choose_program,
            cmake::cmake_kits,
            cmake::cmake_project,
            cmake::cmake_run,
            cmake::cmake_cancel,
            cmake::ctest::cmake_tests,
            cmake::ctest::cmake_test,
            debug::debug_debuggers,
            debug::debug_set_choice,
            debug::debug_choose_debugger,
            debug::debug_reset_debugger,
            debug::debug_state,
            debug::debug_set_state,
            debug::debug_config,
            debug::debug_set_config,
            debug::debug_start,
            debug::debug_launch,
            debug::debug_send,
            debug::debug_stop,
            coverage::coverage_choose,
            coverage::coverage_report,
            coverage::coverage_forget,
            coverage::coverage_modified,
            analysis::analysis_info,
            analysis::analysis_set_settings,
            analysis::analysis_choose_program,
            analysis::analysis_run,
            analysis::analysis_cancel,
            analysis::analysis_check
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Mozaik")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                app.state::<terminal::TerminalSessions>().close_all();
                app.state::<lsp::LanguageServers>().close_all();
                app.state::<cmake::jobs::Jobs>().close_all();
                app.state::<analysis::Analyses>().close_all();
                app.state::<debug::DebugAdapters>().close_all();
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
