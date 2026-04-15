mod claude_index;
mod commands;
mod db;
mod hooks;
mod state;
mod transcript;

use chrono::Utc;
use tauri::Manager;
use uuid::Uuid;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_pty::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app_data_dir must be available");
            let db_path = data_dir.join("agtx.db");
            let conn = db::open(&db_path).expect("failed to open sqlite");
            let orphans = db::mark_orphans_dead(&conn, Utc::now().timestamp_millis())
                .unwrap_or(0);
            if orphans > 0 {
                tracing::info!(orphans, "marked sessions dead from previous run");
            }

            let secret = Uuid::new_v4().to_string();
            let state = state::AppState::new(conn, 0, secret.clone());
            let db_arc = state.db.clone();

            let http = hooks::receiver::start(app.handle().clone(), db_arc, secret)
                .expect("failed to start hook receiver");
            let user_path = state::resolve_user_path();
            tracing::info!(user_path = %user_path, "resolved user PATH");
            let state = state::AppState {
                db: state.db,
                http_port: http.port,
                http_secret: http.secret,
                user_path,
            };
            tracing::info!(port = state.http_port, "hook receiver ready");
            app.manage(state);

            // Garante que os hooks do agtx estão instalados em ~/.claude/settings.json.
            // Só reinstala se algum hook esperado estiver faltando — evita gerar
            // backup a cada inicialização quando já está tudo ok.
            let expected: std::collections::HashSet<&str> = hooks::schema::HookEventKind::all()
                .iter()
                .map(|k| k.as_str())
                .collect();
            let needs_install = match hooks::installer::status() {
                Ok(s) => {
                    let have: std::collections::HashSet<&str> =
                        s.installed_events.iter().map(|x| x.as_str()).collect();
                    !expected.is_subset(&have) || s.has_duplicates
                }
                Err(_) => true,
            };
            if needs_install {
                match hooks::installer::install() {
                    Ok(s) => tracing::info!(
                        events = ?s.installed_events,
                        "agtx hooks installed",
                    ),
                    Err(e) => tracing::warn!(error = %e, "failed to install agtx hooks"),
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_register,
            commands::session_list,
            commands::session_update_status,
            commands::session_update_prompt,
            commands::session_delete,
            commands::session_move,
            commands::event_log,
            commands::events_list,
            commands::http_info,
            commands::transcript_refresh,
            commands::hooks_status,
            commands::hooks_install,
            commands::hooks_uninstall,
            commands::workspace_create,
            commands::workspace_list,
            commands::workspace_update,
            commands::workspace_archive,
            commands::workspace_unarchive,
            commands::workspace_delete,
            commands::claude_sessions_for_cwd,
            commands::task_ensure,
            commands::task_list,
            commands::task_update_status,
            commands::task_update_label,
            commands::task_update_title,
            commands::task_delete,
            commands::label_list,
            commands::label_create,
            commands::label_update,
            commands::label_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
