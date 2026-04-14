use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;

use crate::hooks::schema::HookEventKind;

const AGTX_MARKER: &str = "agtx_managed";

/// Constrói o comando shell que o hook dispara. Lê env vars injetadas pelo
/// agtx no spawn do `claude`.
fn hook_command(event: HookEventKind) -> String {
    // O `-` em curl -d @- lê stdin; Claude Code passa JSON via stdin.
    format!(
        r#"curl -sf -X POST "http://127.0.0.1:${{AGTX_HOOK_PORT:-0}}/hook/{event}" \
  -H "X-Agtx-Secret: ${{AGTX_HOOK_SECRET:-}}" \
  -H "X-Agtx-Tracker: ${{AGTX_SESSION_TRACKER:-}}" \
  -H "Content-Type: application/json" \
  --max-time 2 \
  -d @- >/dev/null 2>&1 || true"#,
        event = event.as_str()
    )
}

pub fn settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("settings.json")
}

fn read_settings() -> Result<Value> {
    let path = settings_path();
    if !path.exists() {
        return Ok(json!({}));
    }
    let raw = fs::read_to_string(&path).with_context(|| format!("read {path:?}"))?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    let parsed: Value = serde_json::from_str(&raw).with_context(|| format!("parse {path:?}"))?;
    Ok(parsed)
}

fn write_settings(value: &Value) -> Result<()> {
    let path = settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let pretty = serde_json::to_string_pretty(value)?;
    fs::write(&path, pretty)?;
    Ok(())
}

fn backup_if_needed() -> Result<Option<PathBuf>> {
    let path = settings_path();
    if !path.exists() {
        return Ok(None);
    }
    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let backup = path.with_extension(format!("json.bak.{ts}"));
    fs::copy(&path, &backup).with_context(|| format!("backup to {backup:?}"))?;
    Ok(Some(backup))
}

/// Retorna apenas os entries que NÃO são gerenciados pelo agtx.
fn strip_agtx(arr: &[Value]) -> Vec<Value> {
    arr.iter()
        .filter(|entry| {
            entry
                .as_object()
                .and_then(|o| o.get(AGTX_MARKER))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
                == false
        })
        .cloned()
        .collect()
}

fn make_agtx_entry(event: HookEventKind) -> Value {
    json!({
        AGTX_MARKER: true,
        "matcher": "*",
        "hooks": [{
            "type": "command",
            "command": hook_command(event)
        }]
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    pub installed: bool,
    pub settings_path: String,
    pub installed_events: Vec<String>,
}

pub fn status() -> Result<HooksStatus> {
    let value = read_settings()?;
    let mut installed_events = Vec::new();
    if let Some(hooks) = value.get("hooks").and_then(|v| v.as_object()) {
        for (event_name, entries) in hooks {
            if let Some(arr) = entries.as_array() {
                let has_agtx = arr.iter().any(|e| {
                    e.get(AGTX_MARKER)
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false)
                });
                if has_agtx {
                    installed_events.push(event_name.clone());
                }
            }
        }
    }
    Ok(HooksStatus {
        installed: !installed_events.is_empty(),
        settings_path: settings_path().to_string_lossy().to_string(),
        installed_events,
    })
}

pub fn install() -> Result<HooksStatus> {
    backup_if_needed()?;
    let mut value = read_settings()?;

    let root = value
        .as_object_mut()
        .context("settings.json root must be object")?;

    let hooks = root
        .entry("hooks".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let hooks_obj = hooks
        .as_object_mut()
        .context("settings.json 'hooks' must be object")?;

    for kind in HookEventKind::all() {
        let arr = hooks_obj
            .entry(kind.as_str().to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(existing) = arr.as_array() {
            let mut stripped = strip_agtx(existing);
            stripped.push(make_agtx_entry(*kind));
            *arr = Value::Array(stripped);
        }
    }

    write_settings(&value)?;
    status()
}

pub fn uninstall() -> Result<HooksStatus> {
    backup_if_needed()?;
    let mut value = read_settings()?;
    if let Some(hooks) = value.get_mut("hooks").and_then(|v| v.as_object_mut()) {
        let keys: Vec<String> = hooks.keys().cloned().collect();
        for k in keys {
            if let Some(arr) = hooks.get(&k).and_then(|v| v.as_array()).cloned() {
                let stripped = strip_agtx(&arr);
                if stripped.is_empty() {
                    hooks.remove(&k);
                } else {
                    hooks.insert(k, Value::Array(stripped));
                }
            }
        }
        // Se ficou vazio, remove a chave 'hooks'.
        if hooks.is_empty() {
            value.as_object_mut().unwrap().remove("hooks");
        }
    }
    write_settings(&value)?;
    status()
}
