use chrono::Utc;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::claude_index;
use crate::db;
use crate::hooks::installer;
use crate::state::AppState;
use crate::transcript;

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
pub fn session_register(
    state: State<'_, AppState>,
    session: db::DbSession,
) -> Result<db::DbSession, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_session(&conn, &session).map_err(map_err)?;
    db::append_event(
        &conn,
        &session.id,
        "session.register",
        Some(
            &serde_json::to_string(&session)
                .unwrap_or_else(|_| "{}".into()),
        ),
        now_ms(),
    )
    .map_err(map_err)?;
    Ok(session)
}

#[tauri::command]
pub fn session_list(state: State<'_, AppState>) -> Result<Vec<db::DbSession>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_sessions(&conn).map_err(map_err)
}

#[tauri::command]
pub fn session_update_status(
    state: State<'_, AppState>,
    id: String,
    status: String,
) -> Result<(), String> {
    let now = now_ms();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_status(&conn, &id, &status, now).map_err(map_err)?;
    db::append_event(
        &conn,
        &id,
        "status",
        Some(&format!("{{\"status\":\"{status}\"}}")),
        now,
    )
    .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn session_update_prompt(
    state: State<'_, AppState>,
    id: String,
    prompt: String,
) -> Result<(), String> {
    let now = now_ms();
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_last_prompt(&conn, &id, &prompt, now).map_err(map_err)?;
    db::append_event(
        &conn,
        &id,
        "prompt",
        Some(&serde_json::json!({ "prompt": prompt }).to_string()),
        now,
    )
    .map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn session_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_session(&conn, &id).map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn event_log(
    state: State<'_, AppState>,
    session_id: String,
    kind: String,
    payload: Option<serde_json::Value>,
) -> Result<i64, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let payload_str = payload
        .as_ref()
        .map(|v| v.to_string());
    db::append_event(&conn, &session_id, &kind, payload_str.as_deref(), now_ms())
        .map_err(map_err)
}

#[tauri::command]
pub fn events_list(
    state: State<'_, AppState>,
    session_id: String,
    limit: Option<i64>,
) -> Result<Vec<db::DbEvent>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_events(&conn, &session_id, limit.unwrap_or(200)).map_err(map_err)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HttpInfo {
    pub port: u16,
    pub secret: String,
    pub user_path: String,
}

#[tauri::command]
pub fn http_info(state: State<'_, AppState>) -> HttpInfo {
    HttpInfo {
        port: state.http_port,
        secret: state.http_secret.clone(),
        user_path: state.user_path.clone(),
    }
}

/// Reparse do transcript on-demand. Útil para detectar trocas de modelo
/// (via /model ou Ctrl+P) que não disparam hooks, mas alteram o transcript.
/// Emite `session-metrics` se o parse for bem-sucedido.
#[tauri::command]
pub fn transcript_refresh(
    state: State<'_, AppState>,
    app: AppHandle,
    session_id: String,
    transcript_path: String,
) -> Result<(), String> {
    let path = std::path::Path::new(&transcript_path);
    if !path.is_file() {
        return Ok(());
    }
    let metrics = transcript::parse(path).map_err(map_err)?;
    let metrics_json = serde_json::to_string(&metrics).unwrap_or_else(|_| "{}".into());
    {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::update_session_metrics(
            &conn,
            &session_id,
            metrics.model.as_deref(),
            Some(&transcript_path),
            &metrics_json,
            now_ms(),
        )
        .map_err(map_err)?;
    }

    #[derive(serde::Serialize)]
    #[serde(rename_all = "camelCase")]
    struct MetricsEvent<'a> {
        session_id: &'a str,
        metrics: &'a transcript::SessionMetrics,
        transcript_path: Option<&'a str>,
    }
    let ev = MetricsEvent {
        session_id: &session_id,
        metrics: &metrics,
        transcript_path: Some(&transcript_path),
    };
    let _ = app.emit("session-metrics", &ev);
    Ok(())
}

#[tauri::command]
pub fn hooks_status() -> Result<installer::HooksStatus, String> {
    installer::status().map_err(map_err)
}

#[tauri::command]
pub fn hooks_install() -> Result<installer::HooksStatus, String> {
    installer::install().map_err(map_err)
}

#[tauri::command]
pub fn hooks_uninstall() -> Result<installer::HooksStatus, String> {
    installer::uninstall().map_err(map_err)
}

// ----- Workspaces -----

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCreateInput {
    pub name: String,
    pub root_cwd: String,
    pub default_cli: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdateInput {
    pub name: Option<String>,
    pub root_cwd: Option<String>,
    #[serde(default, deserialize_with = "deserialize_option_option")]
    pub default_cli: Option<Option<String>>,
    pub color: Option<String>,
}

/// Permite que o frontend envie `defaultCli: null` explicitamente (quer limpar)
/// vs não enviar o campo (manter). Implementação manual porque serde não
/// distingue nativamente os dois casos.
fn deserialize_option_option<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::Deserialize;
    let v = Option::<Option<String>>::deserialize(deserializer)?;
    Ok(Some(v.unwrap_or(None)))
}

#[tauri::command]
pub fn workspace_create(
    state: State<'_, AppState>,
    input: WorkspaceCreateInput,
) -> Result<db::DbWorkspace, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let color = input
        .color
        .filter(|c| db::WORKSPACE_COLORS.contains(&c.as_str()))
        .unwrap_or_else(|| {
            let sum: u32 = input.name.bytes().map(u32::from).sum();
            db::WORKSPACE_COLORS[(sum as usize) % db::WORKSPACE_COLORS.len()].to_string()
        });
    let ws = db::DbWorkspace {
        id: uuid::Uuid::new_v4().to_string(),
        name: input.name.trim().to_string(),
        root_cwd: input.root_cwd,
        default_cli: input.default_cli.filter(|s| !s.is_empty()),
        color,
        created_at: now_ms(),
        archived_at: None,
    };
    db::insert_workspace(&conn, &ws).map_err(map_err)?;
    Ok(ws)
}

#[tauri::command]
pub fn workspace_list(
    state: State<'_, AppState>,
    include_archived: Option<bool>,
) -> Result<Vec<db::DbWorkspace>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_workspaces(&conn, include_archived.unwrap_or(false)).map_err(map_err)
}

#[tauri::command]
pub fn workspace_update(
    state: State<'_, AppState>,
    id: String,
    patch: WorkspaceUpdateInput,
) -> Result<db::DbWorkspace, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_workspace(
        &conn,
        &id,
        patch.name.as_deref(),
        patch.root_cwd.as_deref(),
        patch.default_cli.as_ref().map(|o| o.as_deref()),
        patch.color.as_deref(),
    )
    .map_err(map_err)?;
    db::get_workspace(&conn, &id)
        .map_err(map_err)?
        .ok_or_else(|| "workspace not found".to_string())
}

#[tauri::command]
pub fn workspace_archive(
    state: State<'_, AppState>,
    id: String,
) -> Result<db::DbWorkspace, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::archive_workspace(&conn, &id, now_ms()).map_err(map_err)?;
    db::get_workspace(&conn, &id)
        .map_err(map_err)?
        .ok_or_else(|| "workspace not found".to_string())
}

#[tauri::command]
pub fn workspace_unarchive(
    state: State<'_, AppState>,
    id: String,
) -> Result<db::DbWorkspace, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::unarchive_workspace(&conn, &id).map_err(map_err)?;
    db::get_workspace(&conn, &id)
        .map_err(map_err)?
        .ok_or_else(|| "workspace not found".to_string())
}

#[tauri::command]
pub fn workspace_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let ws = db::get_workspace(&conn, &id)
        .map_err(map_err)?
        .ok_or_else(|| "workspace not found".to_string())?;
    if ws.archived_at.is_none() {
        return Err("archive workspace before deleting".to_string());
    }
    let count = db::count_sessions_in_workspace(&conn, &id).map_err(map_err)?;
    if count > 0 {
        return Err(format!("workspace still has {count} sessions"));
    }
    db::delete_workspace(&conn, &id).map_err(map_err)?;
    Ok(())
}

#[tauri::command]
pub fn claude_sessions_for_cwd(
    cwd: String,
) -> Result<Vec<claude_index::ClaudeSessionSummary>, String> {
    claude_index::list_sessions_for_cwd(&cwd).map_err(map_err)
}

// ----- Tasks -----

#[tauri::command]
pub fn task_ensure(
    state: State<'_, AppState>,
    workspace_id: String,
    claude_session_id: String,
    status: Option<String>,
) -> Result<db::DbTask, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::ensure_task(
        &conn,
        &workspace_id,
        &claude_session_id,
        status.as_deref().unwrap_or("backlog"),
        now_ms(),
    )
    .map_err(map_err)
}

#[tauri::command]
pub fn task_list(
    state: State<'_, AppState>,
    workspace_id: Option<String>,
) -> Result<Vec<db::DbTask>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_tasks(&conn, workspace_id.as_deref()).map_err(map_err)
}

#[tauri::command]
pub fn task_update_status(
    state: State<'_, AppState>,
    claude_session_id: String,
    status: String,
) -> Result<db::DbTask, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_task_status(&conn, &claude_session_id, &status, now_ms())
        .map_err(map_err)?;
    db::get_task_by_claude_id(&conn, &claude_session_id)
        .map_err(map_err)?
        .ok_or_else(|| "task not found".to_string())
}

#[tauri::command]
pub fn task_update_label(
    state: State<'_, AppState>,
    claude_session_id: String,
    label: Option<String>,
) -> Result<db::DbTask, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let label_ref = label.as_deref().filter(|s| !s.is_empty());
    db::update_task_label(&conn, &claude_session_id, label_ref).map_err(map_err)?;
    db::get_task_by_claude_id(&conn, &claude_session_id)
        .map_err(map_err)?
        .ok_or_else(|| "task not found".to_string())
}

#[tauri::command]
pub fn task_update_title(
    state: State<'_, AppState>,
    claude_session_id: String,
    title: Option<String>,
) -> Result<db::DbTask, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let title_ref = title.as_deref().filter(|s| !s.is_empty());
    db::update_task_title(&conn, &claude_session_id, title_ref).map_err(map_err)?;
    db::get_task_by_claude_id(&conn, &claude_session_id)
        .map_err(map_err)?
        .ok_or_else(|| "task not found".to_string())
}

#[tauri::command]
pub fn task_delete(
    state: State<'_, AppState>,
    claude_session_id: String,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_task(&conn, &claude_session_id).map_err(map_err)
}

// ----- Labels -----

#[tauri::command]
pub fn label_list(state: State<'_, AppState>) -> Result<Vec<db::DbLabel>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_labels(&conn).map_err(map_err)
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelCreateInput {
    pub name: String,
    pub color: String,
}

#[tauri::command]
pub fn label_create(
    state: State<'_, AppState>,
    input: LabelCreateInput,
) -> Result<db::DbLabel, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let id = slugify(&input.name);
    if id.is_empty() {
        return Err("name inválido".to_string());
    }
    let name = input.name.trim().to_string();
    db::create_label(&conn, &id, &name, &input.color, now_ms()).map_err(map_err)?;
    db::get_label(&conn, &id)
        .map_err(map_err)?
        .ok_or_else(|| "label not found after insert".to_string())
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelUpdateInput {
    pub name: Option<String>,
    pub color: Option<String>,
}

#[tauri::command]
pub fn label_update(
    state: State<'_, AppState>,
    id: String,
    patch: LabelUpdateInput,
) -> Result<db::DbLabel, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::update_label(&conn, &id, patch.name.as_deref(), patch.color.as_deref())
        .map_err(map_err)?;
    db::get_label(&conn, &id)
        .map_err(map_err)?
        .ok_or_else(|| "label not found".to_string())
}

#[tauri::command]
pub fn label_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_label(&conn, &id).map_err(map_err)
}

fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = false;
    for ch in s.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            for c in ch.to_lowercase() {
                out.push(c);
            }
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

#[tauri::command]
pub fn session_move(
    state: State<'_, AppState>,
    id: String,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::move_session(&conn, &id, workspace_id.as_deref(), now_ms()).map_err(map_err)?;
    db::append_event(
        &conn,
        &id,
        "session.move",
        Some(
            &serde_json::json!({ "workspaceId": workspace_id })
                .to_string(),
        ),
        now_ms(),
    )
    .map_err(map_err)?;
    Ok(())
}
