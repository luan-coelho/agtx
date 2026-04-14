use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

/// Paleta canônica de cores para workspaces.
pub const WORKSPACE_COLORS: &[&str] = &[
    "lime", "sky", "violet", "amber", "rose", "emerald", "cyan", "fuchsia",
];

const SCHEMA_V2: &str = r#"
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    root_cwd TEXT NOT NULL,
    default_cli TEXT,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    cli TEXT NOT NULL,
    cwd TEXT NOT NULL,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    status TEXT NOT NULL,
    claude_session_id TEXT,
    created_at INTEGER NOT NULL,
    last_activity_at INTEGER NOT NULL,
    pid INTEGER,
    last_prompt TEXT,
    model TEXT,
    transcript_path TEXT,
    metrics TEXT
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    claude_session_id TEXT NOT NULL UNIQUE,
    seq INTEGER NOT NULL,
    title_override TEXT,
    status TEXT NOT NULL DEFAULT 'backlog',
    label TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    UNIQUE(workspace_id, seq)
);

CREATE TABLE IF NOT EXISTS labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_workspace
    ON sessions(workspace_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, seq DESC);
"#;

/// Labels padrão criados na migration v5. `(id_fixo, name, color)`.
const DEFAULT_LABELS: &[(&str, &str, &str)] = &[
    ("bug", "Bug", "rose"),
    ("feature", "Feature", "sky"),
    ("enhancement", "Enhancement", "emerald"),
    ("refactor", "Refactor", "amber"),
    ("research", "Research", "cyan"),
];

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating db dir {parent:?}"))?;
    }
    let conn = Connection::open(path).with_context(|| format!("opening db {path:?}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    apply_migrations(&conn, path)?;
    Ok(conn)
}

/// Detecta se o DB está em v1 (tem `sessions.tag`) e migra para v2 se preciso.
/// DBs novos pulam para v2 direto.
fn apply_migrations(conn: &Connection, db_path: &Path) -> Result<()> {
    let user_version: i64 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap_or(0);

    if user_version >= 5 {
        conn.execute_batch(SCHEMA_V2)?;
        return Ok(());
    }

    if user_version == 4 {
        conn.execute_batch(SCHEMA_V2)?;
        migrate_v4_to_v5(conn)?;
        return Ok(());
    }

    if user_version == 3 {
        conn.execute_batch(SCHEMA_V2)?;
        migrate_v3_to_v4(conn)?;
        migrate_v4_to_v5(conn)?;
        return Ok(());
    }

    if user_version == 2 {
        conn.execute_batch(SCHEMA_V2)?;
        migrate_v2_to_v3(conn)?;
        migrate_v3_to_v4(conn)?;
        migrate_v4_to_v5(conn)?;
        return Ok(());
    }

    let sessions_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if !sessions_exists {
        // DB novo: cria direto na versão corrente.
        conn.execute_batch(SCHEMA_V2)?;
        seed_default_labels(conn, Utc::now().timestamp_millis())?;
        conn.pragma_update(None, "user_version", 5)?;
        return Ok(());
    }

    let has_tag: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('sessions') WHERE name='tag')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(false);

    if has_tag {
        migrate_v1_to_v2(conn, db_path)?;
    } else {
        // DB v1 sem coluna tag (improvável, mas tratado): só cria workspaces.
        conn.execute_batch(SCHEMA_V2)?;
        conn.pragma_update(None, "user_version", 2)?;
    }
    migrate_v2_to_v3(conn)?;
    migrate_v3_to_v4(conn)?;
    migrate_v2_to_v3(conn)?;

    Ok(())
}

fn migrate_v2_to_v3(conn: &Connection) -> Result<()> {
    tracing::info!("migrating schema v2 → v3");
    let alter = |sql: &str| {
        // Ignora erro se coluna já existe (idempotente).
        if let Err(e) = conn.execute(sql, []) {
            let msg = e.to_string();
            if !msg.contains("duplicate column name") {
                tracing::warn!(error = %e, sql, "alter column failed");
            }
        }
    };
    alter("ALTER TABLE sessions ADD COLUMN model TEXT");
    alter("ALTER TABLE sessions ADD COLUMN transcript_path TEXT");
    alter("ALTER TABLE sessions ADD COLUMN metrics TEXT");
    conn.pragma_update(None, "user_version", 3)?;
    Ok(())
}

fn migrate_v3_to_v4(conn: &Connection) -> Result<()> {
    tracing::info!("migrating schema v3 → v4");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
            claude_session_id TEXT NOT NULL UNIQUE,
            seq INTEGER NOT NULL,
            title_override TEXT,
            status TEXT NOT NULL DEFAULT 'backlog',
            label TEXT,
            created_at INTEGER NOT NULL,
            completed_at INTEGER,
            UNIQUE(workspace_id, seq)
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, seq DESC);",
    )?;
    conn.pragma_update(None, "user_version", 4)?;
    Ok(())
}

fn seed_default_labels(conn: &Connection, at: i64) -> Result<()> {
    for (id, name, color) in DEFAULT_LABELS {
        conn.execute(
            "INSERT OR IGNORE INTO labels (id, name, color, created_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, name, color, at],
        )?;
    }
    Ok(())
}

fn migrate_v4_to_v5(conn: &Connection) -> Result<()> {
    tracing::info!("migrating schema v4 → v5");
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS labels (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            color TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
    )?;
    seed_default_labels(conn, Utc::now().timestamp_millis())?;
    conn.pragma_update(None, "user_version", 5)?;
    Ok(())
}

fn migrate_v1_to_v2(conn: &Connection, db_path: &Path) -> Result<()> {
    tracing::info!("migrating schema v1 → v2");

    // 1. Backup atômico via VACUUM INTO.
    let ts = Utc::now().format("%Y%m%d-%H%M%S");
    let backup = db_path.with_extension(format!("db.bak.{ts}"));
    let backup_escaped = backup.to_string_lossy().replace('\'', "''");
    conn.execute(&format!("VACUUM INTO '{backup_escaped}'"), [])?;
    tracing::info!(?backup, "db backup created");

    // 2. Migration em transação.
    let now = Utc::now().timestamp_millis();
    conn.execute_batch("BEGIN")?;

    let run = || -> Result<()> {
        // Cria tabela workspaces e índices auxiliares.
        conn.execute(
            "CREATE TABLE workspaces (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                root_cwd TEXT NOT NULL,
                default_cli TEXT,
                color TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                archived_at INTEGER
            )",
            [],
        )?;
        conn.execute(
            "ALTER TABLE sessions ADD COLUMN workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL",
            [],
        )?;

        // Coleta tags distintas e cwds por tag.
        let mut tag_to_cwds: std::collections::BTreeMap<String, Vec<String>> =
            std::collections::BTreeMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT tag, cwd FROM sessions WHERE tag IS NOT NULL AND tag != ''",
            )?;
            let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
            for row in rows {
                let (tag, cwd) = row?;
                tag_to_cwds.entry(tag).or_default().push(cwd);
            }
        }

        // Insere workspaces (com sufixo -N em caso de colisão) e atualiza sessions.
        let mut existing_names: std::collections::BTreeSet<String> = Default::default();
        for (tag, cwds) in tag_to_cwds {
            let mut name = tag.clone();
            let mut counter = 2;
            while existing_names.contains(&name) {
                name = format!("{tag}-{counter}");
                counter += 1;
            }
            existing_names.insert(name.clone());

            let root_cwd = common_path_prefix(&cwds).unwrap_or_else(|| cwds[0].clone());
            let color = pick_color(&name);
            let id = Uuid::new_v4().to_string();

            conn.execute(
                "INSERT INTO workspaces (id, name, root_cwd, default_cli, color, created_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5)",
                params![id, name, root_cwd, color, now],
            )?;
            conn.execute(
                "UPDATE sessions SET workspace_id = ?1 WHERE tag = ?2",
                params![id, tag],
            )?;
        }

        // Drop tag (SQLite 3.35+).
        conn.execute("ALTER TABLE sessions DROP COLUMN tag", [])?;

        // Índice agora que workspace_id existe.
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_sessions_workspace
             ON sessions(workspace_id, last_activity_at DESC)",
            [],
        )?;

        Ok(())
    };

    match run() {
        Ok(()) => {
            conn.execute_batch("COMMIT")?;
            conn.pragma_update(None, "user_version", 2)?;
            tracing::info!("migration v2 committed");
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK");
            tracing::error!(error = %e, "migration v2 failed; keeping v1. Backup: {backup:?}");
            return Err(e).context("migration v1→v2 failed (rolled back)");
        }
    }

    Ok(())
}

fn common_path_prefix(paths: &[String]) -> Option<String> {
    if paths.is_empty() {
        return None;
    }
    let mut prefix: String = paths[0].clone();
    for p in &paths[1..] {
        while !p.starts_with(&prefix) {
            match prefix.rfind('/') {
                Some(idx) if idx > 0 => prefix.truncate(idx),
                _ => return None,
            }
        }
    }
    // Evita trailing slash (exceto quando é só "/").
    if prefix.len() > 1 && prefix.ends_with('/') {
        prefix.pop();
    }
    if prefix.is_empty() {
        None
    } else {
        Some(prefix)
    }
}

fn pick_color(name: &str) -> String {
    let sum: u32 = name.bytes().map(u32::from).sum();
    WORKSPACE_COLORS[(sum as usize) % WORKSPACE_COLORS.len()].to_string()
}

// ----- Models -----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbSession {
    pub id: String,
    pub cli: String,
    pub cwd: String,
    pub workspace_id: Option<String>,
    pub status: String,
    pub claude_session_id: Option<String>,
    pub created_at: i64,
    pub last_activity_at: i64,
    pub pid: Option<i64>,
    pub last_prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub transcript_path: Option<String>,
    /// JSON serializado de `SessionMetrics` (camelCase).
    #[serde(default)]
    pub metrics: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbEvent {
    pub id: i64,
    pub session_id: String,
    pub kind: String,
    pub payload: Option<String>,
    pub at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbWorkspace {
    pub id: String,
    pub name: String,
    pub root_cwd: String,
    pub default_cli: Option<String>,
    pub color: String,
    pub created_at: i64,
    pub archived_at: Option<i64>,
}

// ----- Sessions -----

pub fn upsert_session(conn: &Connection, s: &DbSession) -> Result<()> {
    conn.execute(
        "INSERT INTO sessions
         (id, cli, cwd, workspace_id, status, claude_session_id, created_at, last_activity_at, pid, last_prompt, model, transcript_path, metrics)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
            cli=excluded.cli,
            cwd=excluded.cwd,
            workspace_id=excluded.workspace_id,
            status=excluded.status,
            claude_session_id=excluded.claude_session_id,
            last_activity_at=excluded.last_activity_at,
            pid=excluded.pid,
            last_prompt=excluded.last_prompt",
        params![
            s.id,
            s.cli,
            s.cwd,
            s.workspace_id,
            s.status,
            s.claude_session_id,
            s.created_at,
            s.last_activity_at,
            s.pid,
            s.last_prompt,
            s.model,
            s.transcript_path,
            s.metrics,
        ],
    )?;
    Ok(())
}

pub fn update_session_metrics(
    conn: &Connection,
    id: &str,
    model: Option<&str>,
    transcript_path: Option<&str>,
    metrics_json: &str,
    at: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET
            model = COALESCE(?2, model),
            transcript_path = COALESCE(?3, transcript_path),
            metrics = ?4,
            last_activity_at = ?5
         WHERE id = ?1",
        params![id, model, transcript_path, metrics_json, at],
    )?;
    Ok(())
}

pub fn update_status(
    conn: &Connection,
    id: &str,
    status: &str,
    last_activity_at: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET status = ?2, last_activity_at = ?3 WHERE id = ?1",
        params![id, status, last_activity_at],
    )?;
    Ok(())
}

pub fn update_last_prompt(conn: &Connection, id: &str, prompt: &str, at: i64) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET last_prompt = ?2, last_activity_at = ?3 WHERE id = ?1",
        params![id, prompt, at],
    )?;
    Ok(())
}

pub fn delete_session(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn move_session(
    conn: &Connection,
    id: &str,
    workspace_id: Option<&str>,
    at: i64,
) -> Result<()> {
    conn.execute(
        "UPDATE sessions SET workspace_id = ?2, last_activity_at = ?3 WHERE id = ?1",
        params![id, workspace_id, at],
    )?;
    Ok(())
}

pub fn list_sessions(conn: &Connection) -> Result<Vec<DbSession>> {
    let mut stmt = conn.prepare(
        "SELECT id, cli, cwd, workspace_id, status, claude_session_id, created_at, last_activity_at, pid, last_prompt, model, transcript_path, metrics
         FROM sessions ORDER BY last_activity_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DbSession {
            id: r.get(0)?,
            cli: r.get(1)?,
            cwd: r.get(2)?,
            workspace_id: r.get(3)?,
            status: r.get(4)?,
            claude_session_id: r.get(5)?,
            created_at: r.get(6)?,
            last_activity_at: r.get(7)?,
            pid: r.get(8)?,
            last_prompt: r.get(9)?,
            model: r.get(10)?,
            transcript_path: r.get(11)?,
            metrics: r.get(12)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

// ----- Events -----

pub fn append_event(
    conn: &Connection,
    session_id: &str,
    kind: &str,
    payload: Option<&str>,
    at: i64,
) -> Result<i64> {
    conn.execute(
        "INSERT INTO events (session_id, kind, payload, at) VALUES (?1, ?2, ?3, ?4)",
        params![session_id, kind, payload, at],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn list_events(conn: &Connection, session_id: &str, limit: i64) -> Result<Vec<DbEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, session_id, kind, payload, at
         FROM events WHERE session_id = ?1 ORDER BY at DESC LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![session_id, limit], |r| {
        Ok(DbEvent {
            id: r.get(0)?,
            session_id: r.get(1)?,
            kind: r.get(2)?,
            payload: r.get(3)?,
            at: r.get(4)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn mark_orphans_dead(conn: &Connection, at: i64) -> Result<usize> {
    let affected = conn.execute(
        "UPDATE sessions
         SET status = 'dead', last_activity_at = ?1
         WHERE status IN ('starting', 'running', 'idle', 'waiting-input', 'needs-attention')",
        params![at],
    )?;
    Ok(affected)
}

// ----- Workspaces -----

pub fn insert_workspace(conn: &Connection, w: &DbWorkspace) -> Result<()> {
    conn.execute(
        "INSERT INTO workspaces (id, name, root_cwd, default_cli, color, created_at, archived_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            w.id,
            w.name,
            w.root_cwd,
            w.default_cli,
            w.color,
            w.created_at,
            w.archived_at
        ],
    )?;
    Ok(())
}

pub fn update_workspace(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    root_cwd: Option<&str>,
    default_cli: Option<Option<&str>>,
    color: Option<&str>,
) -> Result<()> {
    if let Some(v) = name {
        conn.execute(
            "UPDATE workspaces SET name = ?2 WHERE id = ?1",
            params![id, v],
        )?;
    }
    if let Some(v) = root_cwd {
        conn.execute(
            "UPDATE workspaces SET root_cwd = ?2 WHERE id = ?1",
            params![id, v],
        )?;
    }
    if let Some(v) = default_cli {
        conn.execute(
            "UPDATE workspaces SET default_cli = ?2 WHERE id = ?1",
            params![id, v],
        )?;
    }
    if let Some(v) = color {
        conn.execute(
            "UPDATE workspaces SET color = ?2 WHERE id = ?1",
            params![id, v],
        )?;
    }
    Ok(())
}

pub fn archive_workspace(conn: &Connection, id: &str, at: i64) -> Result<()> {
    conn.execute(
        "UPDATE workspaces SET archived_at = ?2 WHERE id = ?1",
        params![id, at],
    )?;
    Ok(())
}

pub fn unarchive_workspace(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE workspaces SET archived_at = NULL WHERE id = ?1",
        params![id],
    )?;
    Ok(())
}

pub fn delete_workspace(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM workspaces WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn count_sessions_in_workspace(conn: &Connection, id: &str) -> Result<i64> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM sessions WHERE workspace_id = ?1",
        params![id],
        |r| r.get(0),
    )?;
    Ok(count)
}

pub fn list_workspaces(conn: &Connection, include_archived: bool) -> Result<Vec<DbWorkspace>> {
    let sql = if include_archived {
        "SELECT id, name, root_cwd, default_cli, color, created_at, archived_at
         FROM workspaces ORDER BY name COLLATE NOCASE ASC"
    } else {
        "SELECT id, name, root_cwd, default_cli, color, created_at, archived_at
         FROM workspaces WHERE archived_at IS NULL
         ORDER BY name COLLATE NOCASE ASC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |r| {
        Ok(DbWorkspace {
            id: r.get(0)?,
            name: r.get(1)?,
            root_cwd: r.get(2)?,
            default_cli: r.get(3)?,
            color: r.get(4)?,
            created_at: r.get(5)?,
            archived_at: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_workspace(conn: &Connection, id: &str) -> Result<Option<DbWorkspace>> {
    let r = conn.query_row(
        "SELECT id, name, root_cwd, default_cli, color, created_at, archived_at
         FROM workspaces WHERE id = ?1",
        params![id],
        |r| {
            Ok(DbWorkspace {
                id: r.get(0)?,
                name: r.get(1)?,
                root_cwd: r.get(2)?,
                default_cli: r.get(3)?,
                color: r.get(4)?,
                created_at: r.get(5)?,
                archived_at: r.get(6)?,
            })
        },
    );
    match r {
        Ok(w) => Ok(Some(w)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

// ----- Tasks -----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbTask {
    pub id: i64,
    pub workspace_id: String,
    pub claude_session_id: String,
    pub seq: i64,
    pub title_override: Option<String>,
    pub status: String,
    pub label: Option<String>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
}

fn next_task_seq(conn: &Connection, workspace_id: &str) -> Result<i64> {
    let seq: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(seq), 0) + 1 FROM tasks WHERE workspace_id = ?1",
            params![workspace_id],
            |r| r.get(0),
        )
        .unwrap_or(1);
    Ok(seq)
}

pub fn get_task_by_claude_id(
    conn: &Connection,
    claude_session_id: &str,
) -> Result<Option<DbTask>> {
    let r = conn.query_row(
        "SELECT id, workspace_id, claude_session_id, seq, title_override, status, label, created_at, completed_at
         FROM tasks WHERE claude_session_id = ?1",
        params![claude_session_id],
        |r| {
            Ok(DbTask {
                id: r.get(0)?,
                workspace_id: r.get(1)?,
                claude_session_id: r.get(2)?,
                seq: r.get(3)?,
                title_override: r.get(4)?,
                status: r.get(5)?,
                label: r.get(6)?,
                created_at: r.get(7)?,
                completed_at: r.get(8)?,
            })
        },
    );
    match r {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Cria task se não existe para o claude_session_id. Retorna a task existente ou recém-criada.
pub fn ensure_task(
    conn: &Connection,
    workspace_id: &str,
    claude_session_id: &str,
    initial_status: &str,
    at: i64,
) -> Result<DbTask> {
    if let Some(existing) = get_task_by_claude_id(conn, claude_session_id)? {
        return Ok(existing);
    }
    let seq = next_task_seq(conn, workspace_id)?;
    conn.execute(
        "INSERT INTO tasks
            (workspace_id, claude_session_id, seq, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![workspace_id, claude_session_id, seq, initial_status, at],
    )?;
    // Devolve a task completa.
    get_task_by_claude_id(conn, claude_session_id)?
        .ok_or_else(|| anyhow::anyhow!("task not found after insert"))
}

pub fn list_tasks(
    conn: &Connection,
    workspace_id: Option<&str>,
) -> Result<Vec<DbTask>> {
    let rows = match workspace_id {
        Some(ws) => {
            let mut stmt = conn.prepare(
                "SELECT id, workspace_id, claude_session_id, seq, title_override, status, label, created_at, completed_at
                 FROM tasks WHERE workspace_id = ?1 ORDER BY seq DESC",
            )?;
            let iter = stmt.query_map(params![ws], |r| {
                Ok(DbTask {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    claude_session_id: r.get(2)?,
                    seq: r.get(3)?,
                    title_override: r.get(4)?,
                    status: r.get(5)?,
                    label: r.get(6)?,
                    created_at: r.get(7)?,
                    completed_at: r.get(8)?,
                })
            })?;
            iter.collect::<rusqlite::Result<Vec<_>>>()?
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, workspace_id, claude_session_id, seq, title_override, status, label, created_at, completed_at
                 FROM tasks ORDER BY workspace_id, seq DESC",
            )?;
            let iter = stmt.query_map([], |r| {
                Ok(DbTask {
                    id: r.get(0)?,
                    workspace_id: r.get(1)?,
                    claude_session_id: r.get(2)?,
                    seq: r.get(3)?,
                    title_override: r.get(4)?,
                    status: r.get(5)?,
                    label: r.get(6)?,
                    created_at: r.get(7)?,
                    completed_at: r.get(8)?,
                })
            })?;
            iter.collect::<rusqlite::Result<Vec<_>>>()?
        }
    };
    Ok(rows)
}

pub fn update_task_status(
    conn: &Connection,
    claude_session_id: &str,
    status: &str,
    at: i64,
) -> Result<()> {
    let completed_at: Option<i64> = if status == "done" { Some(at) } else { None };
    conn.execute(
        "UPDATE tasks SET status = ?2, completed_at = CASE WHEN ?2 = 'done' THEN ?3 ELSE NULL END
         WHERE claude_session_id = ?1",
        params![claude_session_id, status, completed_at],
    )?;
    Ok(())
}

pub fn update_task_label(
    conn: &Connection,
    claude_session_id: &str,
    label: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET label = ?2 WHERE claude_session_id = ?1",
        params![claude_session_id, label],
    )?;
    Ok(())
}

pub fn update_task_title(
    conn: &Connection,
    claude_session_id: &str,
    title: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE tasks SET title_override = ?2 WHERE claude_session_id = ?1",
        params![claude_session_id, title],
    )?;
    Ok(())
}

pub fn delete_task(conn: &Connection, claude_session_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM tasks WHERE claude_session_id = ?1",
        params![claude_session_id],
    )?;
    Ok(())
}

// ----- Labels -----

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbLabel {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: i64,
}

pub fn list_labels(conn: &Connection) -> Result<Vec<DbLabel>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, color, created_at FROM labels ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DbLabel {
            id: r.get(0)?,
            name: r.get(1)?,
            color: r.get(2)?,
            created_at: r.get(3)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn create_label(
    conn: &Connection,
    id: &str,
    name: &str,
    color: &str,
    at: i64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO labels (id, name, color, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, name, color, at],
    )?;
    Ok(())
}

pub fn update_label(
    conn: &Connection,
    id: &str,
    name: Option<&str>,
    color: Option<&str>,
) -> Result<()> {
    if let Some(v) = name {
        conn.execute("UPDATE labels SET name = ?2 WHERE id = ?1", params![id, v])?;
    }
    if let Some(v) = color {
        conn.execute("UPDATE labels SET color = ?2 WHERE id = ?1", params![id, v])?;
    }
    Ok(())
}

pub fn delete_label(conn: &Connection, id: &str) -> Result<()> {
    // Limpa label de qualquer task que usava este id.
    conn.execute(
        "UPDATE tasks SET label = NULL WHERE label = ?1",
        params![id],
    )?;
    conn.execute("DELETE FROM labels WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn get_label(conn: &Connection, id: &str) -> Result<Option<DbLabel>> {
    let r = conn.query_row(
        "SELECT id, name, color, created_at FROM labels WHERE id = ?1",
        params![id],
        |r| {
            Ok(DbLabel {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                created_at: r.get(3)?,
            })
        },
    );
    match r {
        Ok(l) => Ok(Some(l)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Encontra o workspace cujo `root_cwd` é prefixo (ou igual) ao `cwd`.
/// Retorna o que tem maior match em termos de comprimento (mais específico).
pub fn find_workspace_for_cwd(conn: &Connection, cwd: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT id, root_cwd FROM workspaces WHERE archived_at IS NULL",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut best: Option<(String, usize)> = None;
    for row in rows {
        let (id, root) = row?;
        if cwd == root || cwd.starts_with(&format!("{root}/")) {
            let len = root.len();
            if best.as_ref().map(|(_, l)| len > *l).unwrap_or(true) {
                best = Some((id, len));
            }
        }
    }
    Ok(best.map(|(id, _)| id))
}

