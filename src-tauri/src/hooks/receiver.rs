use std::net::SocketAddr;
use std::sync::{mpsc, Arc, Mutex};

use anyhow::{anyhow, Result};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use chrono::Utc;
use rusqlite::Connection;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::db;
use crate::hooks::schema::{HookEvent, HookEventKind, HookPayload};
use crate::transcript;

#[derive(Clone)]
pub struct HttpConfig {
    pub port: u16,
    pub secret: String,
}

#[derive(Clone)]
struct HookState {
    db: Arc<Mutex<Connection>>,
    app: AppHandle,
    secret: String,
}

pub fn start(app: AppHandle, db: Arc<Mutex<Connection>>, secret: String) -> Result<HttpConfig> {
    let (tx, rx) = mpsc::sync_channel::<Result<u16>>(1);

    let state = HookState {
        db,
        app,
        secret: secret.clone(),
    };

    let router = Router::new()
        .route("/health", get(health))
        .route("/hook/{event}", post(handle_hook))
        .with_state(Arc::new(state));

    tauri::async_runtime::spawn(async move {
        let listener = match tokio::net::TcpListener::bind("127.0.0.1:0").await {
            Ok(l) => l,
            Err(e) => {
                let _ = tx.send(Err(e.into()));
                return;
            }
        };
        let local = match listener.local_addr() {
            Ok(addr) => addr,
            Err(e) => {
                let _ = tx.send(Err(e.into()));
                return;
            }
        };
        let _ = tx.send(Ok(local.port()));
        tracing::info!(%local, "hook receiver listening");

        if let Err(e) = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        {
            tracing::error!(error = %e, "hook receiver crashed");
        }
    });

    let port = rx
        .recv()
        .map_err(|e| anyhow!("hook receiver bind channel: {e}"))??;
    Ok(HttpConfig { port, secret })
}

async fn health() -> &'static str {
    "ok"
}

async fn handle_hook(
    State(state): State<Arc<HookState>>,
    Path(event): Path<String>,
    headers: HeaderMap,
    body: Option<Json<Value>>,
) -> impl IntoResponse {
    // Auth
    let provided = headers
        .get("x-agtx-secret")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if provided != state.secret {
        return (StatusCode::UNAUTHORIZED, "bad secret").into_response();
    }

    let tracker_id = headers
        .get("x-agtx-tracker")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty());

    let payload_value = body.map(|Json(v)| v).unwrap_or(Value::Null);
    let parsed: HookPayload =
        serde_json::from_value(payload_value.clone()).unwrap_or_else(|_| HookPayload {
            session_id: None,
            transcript_path: None,
            cwd: None,
            hook_event_name: None,
            extra: Value::Null,
        });

    let event_name = HookEventKind::from_str(&event)
        .map(|k| k.as_str().to_string())
        .unwrap_or(event);

    let now_ms = Utc::now().timestamp_millis();

    // Extrai model do payload (SessionStart traz explicitamente).
    let model_from_payload = payload_value
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Persiste o evento + metrics do transcript (se temos tracker_id).
    let mut metrics_for_emit: Option<transcript::SessionMetrics> = None;
    let mut resolved_model: Option<String> = model_from_payload.clone();

    if let Some(ref tid) = tracker_id {
        let db = state.db.clone();
        let tid = tid.clone();
        let kind = event_name.clone();
        let payload_str = payload_value.to_string();
        let claude_sid = parsed.session_id.clone();
        let transcript_path = parsed.transcript_path.clone();
        let model_hint = model_from_payload.clone();

        let parsed_cwd = parsed.cwd.clone();
        let parsed_metrics: Option<transcript::SessionMetrics> =
            tauri::async_runtime::spawn_blocking(move || -> Option<transcript::SessionMetrics> {
                let conn = match db.lock() {
                    Ok(c) => c,
                    Err(_) => return None,
                };
                let _ = db::append_event(
                    &conn,
                    &tid,
                    &format!("hook.{kind}"),
                    Some(&payload_str),
                    now_ms,
                );
                if let Some(cs) = claude_sid.as_ref() {
                    // Upsert: se sessão ainda não foi registrada pelo frontend
                    // (race: hook pode chegar antes), cria uma stub. Se já
                    // existe, apenas atualiza claude_session_id.
                    let default_cwd = parsed_cwd.clone().unwrap_or_default();
                    let _ = conn.execute(
                        "INSERT INTO sessions
                            (id, cli, cwd, status, created_at, last_activity_at, claude_session_id)
                         VALUES (?1, 'claude', ?2, 'idle', ?3, ?3, ?4)
                         ON CONFLICT(id) DO UPDATE SET
                            claude_session_id = excluded.claude_session_id,
                            last_activity_at = excluded.last_activity_at",
                        rusqlite::params![tid, default_cwd, now_ms, cs],
                    );

                    // Auto-cria/atualiza task para esta conversa.
                    let cwd_for_match = parsed_cwd.as_deref().unwrap_or("");
                    if !cwd_for_match.is_empty() {
                        if let Ok(Some(ws_id)) =
                            db::find_workspace_for_cwd(&conn, cwd_for_match)
                        {
                            // Status inicial conforme o evento.
                            let task_status = match kind.as_str() {
                                "UserPromptSubmit" | "PreToolUse"
                                | "PostToolUse" | "SubagentStop" => "planning",
                                "Stop" => "done",
                                "Notification" => "planning",
                                "SessionEnd" => "done",
                                _ => "backlog",
                            };
                            let _ = db::ensure_task(
                                &conn,
                                &ws_id,
                                cs,
                                task_status,
                                now_ms,
                            );
                            // Atualiza status se relevante (ensure só seta na criação).
                            if matches!(
                                kind.as_str(),
                                "UserPromptSubmit"
                                    | "PreToolUse"
                                    | "PostToolUse"
                                    | "SubagentStop"
                                    | "Notification"
                                    | "Stop"
                                    | "SessionEnd"
                            ) {
                                let _ = db::update_task_status(
                                    &conn, cs, task_status, now_ms,
                                );
                            }
                        }
                    }
                }

                // Parse do transcript, se existe e é um arquivo.
                let tp_str = transcript_path.clone();
                if let Some(tp) = transcript_path.as_deref() {
                    let path = std::path::Path::new(tp);
                    if path.is_file() {
                        match transcript::parse(path) {
                            Ok(mut metrics) => {
                                if metrics.model.is_none() {
                                    metrics.model = model_hint;
                                }
                                let metrics_json =
                                    serde_json::to_string(&metrics).unwrap_or_else(|_| "{}".into());
                                let _ = db::update_session_metrics(
                                    &conn,
                                    &tid,
                                    metrics.model.as_deref(),
                                    tp_str.as_deref(),
                                    &metrics_json,
                                    now_ms,
                                );
                                return Some(metrics);
                            }
                            Err(e) => {
                                tracing::debug!(error = %e, path = %tp, "transcript parse failed");
                            }
                        }
                    }
                }
                None
            })
            .await
            .ok()
            .flatten();

        if let Some(m) = parsed_metrics {
            if let Some(ref model) = m.model {
                resolved_model = Some(model.clone());
            }
            metrics_for_emit = Some(m);
        }
    }

    // Se há métricas novas, emite para o frontend.
    if let (Some(ref tid), Some(ref metrics)) = (tracker_id.as_ref(), metrics_for_emit.as_ref()) {
        #[derive(serde::Serialize)]
        #[serde(rename_all = "camelCase")]
        struct MetricsEvent<'a> {
            session_id: &'a str,
            metrics: &'a transcript::SessionMetrics,
            transcript_path: Option<&'a str>,
        }
        let ev = MetricsEvent {
            session_id: tid,
            metrics,
            transcript_path: parsed.transcript_path.as_deref(),
        };
        if let Err(e) = state.app.emit("session-metrics", &ev) {
            tracing::warn!(error = %e, "emit session-metrics failed");
        }
        let _ = resolved_model; // evita warning de unused quando só metrics existe
    }

    // Emite para o frontend.
    let event = HookEvent {
        tracker_id,
        claude_session_id: parsed.session_id,
        event: event_name,
        cwd: parsed.cwd,
        transcript_path: parsed.transcript_path,
        payload: payload_value,
        received_at_ms: now_ms,
    };
    if let Err(e) = state.app.emit("hook-received", &event) {
        tracing::warn!(error = %e, "emit hook-received failed");
    }

    // Resposta default: continua (não bloqueia a ferramenta/sessão).
    (StatusCode::OK, "ok").into_response()
}
