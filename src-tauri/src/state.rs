use std::sync::{Arc, Mutex};

use rusqlite::Connection;

pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub http_port: u16,
    pub http_secret: String,
    /// PATH resolvido via login shell na inicialização. Necessário para que o
    /// PTY encontre binários do usuário (`~/.local/bin/claude`, nvm, bun etc.)
    /// quando o app roda empacotado (fora do terminal, sem herdar a PATH do shell).
    pub user_path: String,
}

impl AppState {
    pub fn new(conn: Connection, http_port: u16, http_secret: String) -> Self {
        Self {
            db: Arc::new(Mutex::new(conn)),
            http_port,
            http_secret,
            user_path: String::new(),
        }
    }
}

/// Executa um login shell do usuário para capturar a PATH configurada em
/// `.zshrc`/`.profile`/`.bashrc`. Em bundles (AppImage, .deb) a PATH herdada
/// do desktop environment costuma ser mínima e não inclui `~/.local/bin`.
pub fn resolve_user_path() -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();

    // Tenta login shell primeiro para herdar tudo que o usuário configurou.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let from_shell = std::process::Command::new(&shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        });

    // Também tenta /bin/bash como fallback caso $SHELL não esteja setado ou
    // seja algo inesperado no bundle.
    let from_bash = if shell != "/bin/bash" {
        std::process::Command::new("/bin/bash")
            .args(["-lc", "printf %s \"$PATH\""])
            .output()
            .ok()
            .filter(|o| o.status.success())
            .and_then(|o| {
                let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
                if s.is_empty() { None } else { Some(s) }
            })
    } else {
        None
    };

    // Diretórios comuns de binários do usuário que queremos garantir estarem
    // na PATH mesmo se o login shell falhar.
    let user_dirs = if !home.is_empty() {
        [
            format!("{home}/.local/bin"),
            format!("{home}/.bun/bin"),
            format!("{home}/.cargo/bin"),
            format!("{home}/.npm-global/bin"),
        ]
        .join(":")
    } else {
        String::new()
    };

    let mut parts: Vec<String> = Vec::new();
    if !user_dirs.is_empty() {
        parts.push(user_dirs);
    }
    if let Some(s) = from_shell {
        parts.push(s);
    }
    if let Some(s) = from_bash {
        parts.push(s);
    }
    if !inherited.is_empty() {
        parts.push(inherited);
    }

    // Deduplica segmentos preservando ordem.
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for chunk in parts.iter().flat_map(|p| p.split(':')) {
        if chunk.is_empty() {
            continue;
        }
        if seen.insert(chunk.to_string()) {
            out.push(chunk.to_string());
        }
    }
    out.join(":")
}
