//! Inspeciona o índice de sessões persistidas do Claude Code.
//!
//! Claude grava cada sessão em `~/.claude/projects/<cwd-encoded>/<session-id>.jsonl`,
//! onde `<cwd-encoded>` substitui `/` por `-`.

use anyhow::Result;
use serde::Serialize;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSessionSummary {
    /// ID da sessão = nome do arquivo sem extensão.
    pub id: String,
    /// Modificação mais recente do arquivo (epoch ms).
    pub modified_at_ms: i64,
    /// Título resolvido: custom-title > último last-prompt > primeiro prompt do usuário.
    pub title: Option<String>,
    /// Título custom definido pelo Claude (`type: "custom-title"`), se houver.
    pub custom_title: Option<String>,
    /// Último prompt (`type: "last-prompt"`), se houver.
    pub last_prompt: Option<String>,
    /// Primeiro prompt user do transcript.
    pub first_user_prompt: Option<String>,
    /// Contagem de linhas (aproximação para número de eventos).
    pub line_count: u64,
    /// Tamanho em bytes.
    pub size_bytes: u64,
}

fn encode_cwd(cwd: &str) -> String {
    cwd.replace('/', "-")
}

fn projects_root() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".claude").join("projects"))
}

fn take_preview(s: &str) -> String {
    let max = 140;
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let prefix: String = s.chars().take(max).collect();
        format!("{prefix}…")
    }
}

/// Lê o arquivo uma única vez e extrai tudo que precisamos.
fn parse_file(path: &Path) -> ClaudeSessionParts {
    let mut parts = ClaudeSessionParts::default();
    let f = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return parts,
    };
    let reader = BufReader::new(f);

    for line in reader.lines().flatten() {
        parts.line_count += 1;
        if line.trim().is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

        match t {
            "custom-title" => {
                if let Some(s) = v.get("customTitle").and_then(|x| x.as_str()) {
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        // custom-title pode aparecer múltiplas vezes; pegamos o último.
                        parts.custom_title = Some(trimmed.to_string());
                    }
                }
            }
            "last-prompt" => {
                if let Some(s) = v.get("lastPrompt").and_then(|x| x.as_str()) {
                    let trimmed = s.trim();
                    if !trimmed.is_empty() {
                        parts.last_prompt = Some(take_preview(trimmed));
                    }
                }
            }
            "user" => {
                if parts.first_user_prompt.is_some() {
                    continue;
                }
                let content = v.get("message").and_then(|m| m.get("content"));
                let candidate = extract_text(content);
                if let Some(text) = candidate {
                    parts.first_user_prompt = Some(take_preview(&text));
                }
            }
            _ => {}
        }
    }

    parts
}

fn extract_text(content: Option<&serde_json::Value>) -> Option<String> {
    let c = content?;
    if let Some(s) = c.as_str() {
        let trimmed = s.trim();
        if !trimmed.is_empty() && !trimmed.starts_with('<') {
            return Some(trimmed.to_string());
        }
        return None;
    }
    if let Some(arr) = c.as_array() {
        for block in arr {
            if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                if let Some(text) = block.get("text").and_then(|x| x.as_str()) {
                    let trimmed = text.trim();
                    if !trimmed.is_empty() && !trimmed.starts_with('<') {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

#[derive(Default)]
struct ClaudeSessionParts {
    custom_title: Option<String>,
    last_prompt: Option<String>,
    first_user_prompt: Option<String>,
    line_count: u64,
}

pub fn list_sessions_for_cwd(cwd: &str) -> Result<Vec<ClaudeSessionSummary>> {
    let root = match projects_root() {
        Some(r) => r,
        None => return Ok(vec![]),
    };
    let dir = root.join(encode_cwd(cwd));
    if !dir.is_dir() {
        return Ok(vec![]);
    }

    let mut out = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_at_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let size_bytes = meta.len();

        let parts = parse_file(&path);
        let title = parts
            .custom_title
            .clone()
            .or_else(|| parts.last_prompt.clone())
            .or_else(|| parts.first_user_prompt.clone());

        out.push(ClaudeSessionSummary {
            id,
            modified_at_ms,
            title,
            custom_title: parts.custom_title,
            last_prompt: parts.last_prompt,
            first_user_prompt: parts.first_user_prompt,
            line_count: parts.line_count,
            size_bytes,
        });
    }

    out.sort_by(|a, b| b.modified_at_ms.cmp(&a.modified_at_ms));
    Ok(out)
}
