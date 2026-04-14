use serde::{Deserialize, Serialize};

/// Eventos nativos do Claude Code.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum HookEventKind {
    SessionStart,
    SessionEnd,
    UserPromptSubmit,
    PreToolUse,
    PostToolUse,
    Notification,
    Stop,
    SubagentStop,
    PreCompact,
}

impl HookEventKind {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "SessionStart" => Some(Self::SessionStart),
            "SessionEnd" => Some(Self::SessionEnd),
            "UserPromptSubmit" => Some(Self::UserPromptSubmit),
            "PreToolUse" => Some(Self::PreToolUse),
            "PostToolUse" => Some(Self::PostToolUse),
            "Notification" => Some(Self::Notification),
            "Stop" => Some(Self::Stop),
            "SubagentStop" => Some(Self::SubagentStop),
            "PreCompact" => Some(Self::PreCompact),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::SessionStart => "SessionStart",
            Self::SessionEnd => "SessionEnd",
            Self::UserPromptSubmit => "UserPromptSubmit",
            Self::PreToolUse => "PreToolUse",
            Self::PostToolUse => "PostToolUse",
            Self::Notification => "Notification",
            Self::Stop => "Stop",
            Self::SubagentStop => "SubagentStop",
            Self::PreCompact => "PreCompact",
        }
    }

    pub fn all() -> &'static [HookEventKind] {
        &[
            Self::SessionStart,
            Self::SessionEnd,
            Self::UserPromptSubmit,
            Self::PreToolUse,
            Self::PostToolUse,
            Self::Notification,
            Self::Stop,
            Self::SubagentStop,
            Self::PreCompact,
        ]
    }
}

/// Payload genérico recebido pelo hook receiver. Os campos comuns (session_id,
/// transcript_path, cwd, hook_event_name) são extraídos; o resto fica em `extra`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookPayload {
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub transcript_path: Option<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub hook_event_name: Option<String>,
    #[serde(flatten)]
    pub extra: serde_json::Value,
}

/// Evento enviado ao frontend via Tauri event bus.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookEvent {
    /// UUID da sessão no agtx (derivado do header X-Agtx-Tracker), se houver.
    pub tracker_id: Option<String>,
    /// session_id do Claude Code (vem no payload).
    pub claude_session_id: Option<String>,
    /// Nome do evento (SessionStart, Stop, ...).
    pub event: String,
    pub cwd: Option<String>,
    pub transcript_path: Option<String>,
    /// Payload completo original.
    pub payload: serde_json::Value,
    pub received_at_ms: i64,
}
