mod analysis;
mod cmake;
mod coverage;
mod debug;
mod directory;
mod drawings;
mod drives;
mod file_clipboard;
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
mod search;
mod shortcuts;
mod tasks;
mod terminal;
mod watching;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;

/// Project folders that new windows open their IDE on (File Manager's Open in IDE), by
/// window label. Each window takes its own once, at start.
#[derive(Default)]
struct WindowStarts(Mutex<HashMap<String, String>>);

// Async: on Windows, building a WebView2 window from a synchronous command deadlocks and
// leaves the new window blank.
#[tauri::command]
async fn new_workspace(
    app: tauri::AppHandle,
    starts: tauri::State<'_, WindowStarts>,
    ide: Option<String>,
) -> Result<(), String> {
    let label = format!("workspace-{}", uuid::Uuid::new_v4());
    if let Some(path) = ide {
        let root = project::root(&path)?;
        starts
            .0
            .lock()
            .map_err(|_| "Window state is unavailable")?
            .insert(label.clone(), project::display(&root));
    }
    let built =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title("Mozaik")
            .inner_size(1100.0, 760.0)
            .min_inner_size(420.0, 320.0)
            .decorations(false)
            .transparent(true)
            .on_navigation(local_navigation)
            .build();
    if built.is_err() {
        forget_start(&starts, &label);
    }
    built.map(|_| ()).map_err(|e| e.to_string())
}
/// The project folder this window was opened for, if any; only the first call returns it,
/// so a reload starts empty like any window.
#[tauri::command]
fn take_window_start(window: tauri::Window, starts: tauri::State<WindowStarts>) -> Option<String> {
    starts.0.lock().ok()?.remove(window.label())
}
/// Developer: Reload Window: ends what the window started (terminals, servers, jobs,
/// watches) as closing it would, so the reloaded page starts like a new window; with `ide`
/// the page opens an IDE on that folder again, as VS Code reopens its folder.
#[tauri::command]
fn reload_window(
    window: tauri::Window,
    starts: tauri::State<WindowStarts>,
    ide: Option<String>,
) -> Result<(), String> {
    forget_start(&starts, window.label());
    if let Some(path) = ide {
        let root = project::root(&path)?;
        starts
            .0
            .lock()
            .map_err(|_| "Window state is unavailable")?
            .insert(window.label().to_string(), project::display(&root));
    }
    release_window(window.app_handle(), window.label());
    Ok(())
}
/// The folder of `mozaik -ide <path>` (also `--ide`), relative to `cwd`.
fn ide_argument(args: &[String], cwd: &std::path::Path) -> Option<std::path::PathBuf> {
    let at = args.iter().position(|a| a == "-ide" || a == "--ide")?;
    let path = std::path::Path::new(args.get(at + 1)?);
    Some(if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    })
}
/// Ends everything a window owns; its renderer is gone or about to start over.
fn release_window(app: &tauri::AppHandle, label: &str) {
    app.state::<watching::Watches>().remove_window(label);
    app.state::<terminal::TerminalSessions>()
        .close_window(label);
    app.state::<lsp::LanguageServers>().close_window(label);
    app.state::<cmake::jobs::Jobs>().close_window(label);
    app.state::<analysis::Analyses>().close_window(label);
    app.state::<debug::DebugAdapters>().close_window(label);
    app.state::<panels::PanelOwner>().release_window(label);
}
fn forget_start(starts: &WindowStarts, label: &str) {
    if let Ok(mut starts) = starts.0.lock() {
        starts.remove(label);
    }
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
            app.manage(search::Searches::default());
            app.manage(file_clipboard::FileClipboard::default());
            app.manage(pins::storage(app.handle()).map_err(std::io::Error::other)?);
            app.manage(tasks::storage(app.handle()).map_err(std::io::Error::other)?);
            app.manage(panels::PanelOwner::default());
            app.manage(WindowStarts::default());
            app.manage(drawings::storage(app.handle()).map_err(std::io::Error::other)?);
            let config = &app.config().app.windows[0];
            // `mozaik -ide <path>` opens the first window with an IDE on that folder.
            let args: Vec<String> = std::env::args().skip(1).collect();
            if let Some(folder) = std::env::current_dir()
                .ok()
                .and_then(|cwd| ide_argument(&args, &cwd))
            {
                match project::root(&folder.to_string_lossy()) {
                    Ok(root) => {
                        if let Ok(mut starts) = app.state::<WindowStarts>().0.lock() {
                            starts.insert(config.label.clone(), project::display(&root));
                        }
                    }
                    Err(e) => eprintln!("mozaik: -ide {}: {e}", folder.display()),
                }
            }
            tauri::WebviewWindowBuilder::from_config(app, config)?
                .on_navigation(local_navigation)
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                forget_start(&window.state::<WindowStarts>(), window.label());
                release_window(window.app_handle(), window.label());
            }
        })
        .invoke_handler(tauri::generate_handler![
            new_workspace,
            take_window_start,
            reload_window,
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
            preferences::choose_prompt_file,
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
            drives::list_drives,
            search::search_directory,
            search::cancel_search,
            shortcuts::shortcut_target,
            file_clipboard::file_clipboard_get,
            file_clipboard::file_clipboard_set,
            operations::plan_transfer,
            operations::transfer_entries,
            operations::cancel_operation,
            operations::trash_entries,
            operations::restore_from_trash,
            operations::delete_permanently,
            pins::pins_list,
            pins::pins_add,
            pins::pins_remove,
            pins::pins_reorder,
            pins::pins_rename,
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
            git::git_log,
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
                file_clipboard::clear_own(app);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn the_ide_argument_names_a_folder_relative_to_the_current_one() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        let cwd = Path::new("/work");
        assert_eq!(
            ide_argument(&args(&["-ide", "."]), cwd),
            Some(cwd.join("."))
        );
        assert_eq!(
            ide_argument(&args(&["--ide", "src"]), cwd),
            Some(cwd.join("src"))
        );
        assert_eq!(ide_argument(&args(&["-ide"]), cwd), None);
        assert_eq!(ide_argument(&args(&["file.txt"]), cwd), None);
        let absolute = std::env::temp_dir();
        assert_eq!(
            ide_argument(&args(&["-ide", &absolute.to_string_lossy()]), cwd),
            Some(absolute)
        );
    }
}
