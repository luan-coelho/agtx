# agtx

Orquestrador desktop de sessões CLI/TUI de agentes de IA (Claude Code, Codex, OpenCode…).

Dashboard com visão agregada de status por sessão, notificações quando uma sessão precisa de atenção e terminais embutidos (xterm.js). Stack: Tauri 2 + React + TypeScript.

## Dev

```sh
pnpm install
pnpm tauri dev
```

## Estrutura

- `src/` — frontend React
- `src-tauri/` — backend Rust (PTYs, hook receiver, SQLite)
