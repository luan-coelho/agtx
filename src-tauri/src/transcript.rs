use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionMetrics {
    pub model: Option<String>,
    pub context_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_read_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub message_count: u64,
    pub first_message_at_ms: Option<i64>,
    pub last_message_at_ms: Option<i64>,
}

/// Lê o transcript JSONL do Claude Code e agrega métricas.
///
/// Formato: cada linha é um JSON com campos como
/// - `type`: "user" | "assistant" | "system" | "summary" ...
/// - `message`: objeto com `model`, `usage { input_tokens, output_tokens,
///    cache_creation_input_tokens, cache_read_input_tokens }` (apenas em
///    assistant turns)
/// - `timestamp`: ISO-8601
pub fn parse(path: &Path) -> Result<SessionMetrics> {
    let file = File::open(path)?;
    let reader = BufReader::new(file);
    let mut m = SessionMetrics::default();

    let mut last_input: u64 = 0;
    let mut last_cache_read: u64 = 0;
    let mut last_cache_creation: u64 = 0;

    for line_result in reader.lines() {
        let line = match line_result {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.trim().is_empty() {
            continue;
        }
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let entry_type = v.get("type").and_then(|x| x.as_str()).unwrap_or("");

        if let Some(ts) = v.get("timestamp").and_then(|x| x.as_str()) {
            if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(ts) {
                let ms = dt.timestamp_millis();
                if m.first_message_at_ms.is_none() {
                    m.first_message_at_ms = Some(ms);
                }
                m.last_message_at_ms = Some(ms);
            }
        }

        match entry_type {
            "user" | "assistant" => {
                m.message_count += 1;
            }
            _ => {}
        }

        if entry_type == "assistant" {
            let message = v.get("message");
            if let Some(model) = message
                .and_then(|msg| msg.get("model"))
                .and_then(|x| x.as_str())
            {
                // Pula modelos sintéticos (ex. "<synthetic>") que Claude Code
                // usa para mensagens de sistema — não representam o modelo real.
                if !model.starts_with('<') {
                    m.model = Some(model.to_string());
                }
            }
            if let Some(usage) = message.and_then(|msg| msg.get("usage")) {
                let input = usage
                    .get("input_tokens")
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0);
                let output = usage
                    .get("output_tokens")
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0);
                let cache_read = usage
                    .get("cache_read_input_tokens")
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0);
                let cache_creation = usage
                    .get("cache_creation_input_tokens")
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0);

                m.total_input_tokens += input;
                m.total_output_tokens += output;
                m.total_cache_read_tokens += cache_read;
                m.total_cache_creation_tokens += cache_creation;

                last_input = input;
                last_cache_read = cache_read;
                last_cache_creation = cache_creation;
            }
        }
    }

    // "Contexto usado na última chamada" = input + cache_read + cache_creation
    // da última assistant message. Representa o tamanho do prompt enviado.
    m.context_tokens = last_input + last_cache_read + last_cache_creation;

    Ok(m)
}
