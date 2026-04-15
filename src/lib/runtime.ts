import { spawn, type IPty } from "tauri-pty";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SerializeAddon } from "@xterm/addon-serialize";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type HookEvent,
  type HttpInfo,
  type SessionMetrics,
  type SessionMetricsEvent,
  type Workspace,
  type WorkspaceCreateInput,
  type WorkspaceUpdateInput,
} from "./tauri";
import type { Cli, CreateSessionOptions, Session } from "./tauri";
import type { SessionStatus } from "./status";

/// Mapeamento hook → status. Atenção: `SessionStart` não é `running`, Claude
/// ainda está ocioso aguardando input. `running` só com `UserPromptSubmit`.
const HOOK_TO_STATUS: Record<string, SessionStatus | undefined> = {
  SessionStart: "idle",
  UserPromptSubmit: "running",
  PreToolUse: "running",
  PostToolUse: "running",
  SubagentStop: "running",
  Notification: "needs-attention",
  Stop: "idle",
  SessionEnd: "dead",
};

/// CLIs onde o status vem dos hooks (fonte primária). Bytes no PTY não
/// devem mudar status para evitar que eco de digitação marque como "rodando".
const HOOK_DRIVEN_CLIS = new Set<string>(["claude"]);

/// Frames de spinners unicode comuns em TUIs — sinal forte de "processando".
/// Conjunto restrito aos chars tipicamente usados como spinner (não o bloco
/// braille inteiro, que inclui decorações estáticas).
const SPINNER_RE =
  /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⣾⣽⣻⢿⡿⣟⣯⣷◐◓◑◒◴◷◶◵⠁⠂⠄⡀⢀⠠⠐⠈]/;

interface RuntimeEntry {
  session: Session;
  pty?: IPty;
  term?: Terminal;
  fit?: FitAddon;
  serialize?: SerializeAddon;
  webgl?: WebglAddon;
  attached: boolean;
  idleTimer: number | null;
}

type Listener = () => void;

const CLI_SPEC: Record<Cli, { file: string; args: string[] }> = {
  claude: { file: "claude", args: [] },
  codex: { file: "codex", args: [] },
  opencode: { file: "opencode", args: [] },
  shell: { file: "bash", args: ["-l"] },
};

const TERM_THEME = {
  background: "#0a0a0a",
  foreground: "#e4e4e7",
  cursor: "#a3e635",
  cursorAccent: "#0a0a0a",
  selectionBackground: "#27272a",
  black: "#27272a",
  red: "#f87171",
  green: "#86efac",
  yellow: "#fcd34d",
  blue: "#93c5fd",
  magenta: "#f0abfc",
  cyan: "#7dd3fc",
  white: "#e4e4e7",
  brightBlack: "#52525b",
  brightRed: "#fca5a5",
  brightGreen: "#bbf7d0",
  brightYellow: "#fde68a",
  brightBlue: "#bfdbfe",
  brightMagenta: "#f5d0fe",
  brightCyan: "#bae6fd",
  brightWhite: "#fafafa",
};

function makeSession(opts: CreateSessionOptions): Session {
  return {
    id: crypto.randomUUID(),
    cli: opts.cli,
    cwd: opts.cwd,
    workspaceId: opts.workspaceId ?? null,
    status: "starting",
    claudeSessionId: null,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
    pid: null,
    lastPrompt: null,
    model: null,
    transcriptPath: null,
    metrics: null,
  };
}

function parsePersistedSession(s: Session): Session {
  let metrics: SessionMetrics | null = null;
  const raw = (s as unknown as { metrics?: unknown }).metrics;
  if (typeof raw === "string" && raw.trim()) {
    try {
      metrics = JSON.parse(raw) as SessionMetrics;
    } catch {
      metrics = null;
    }
  } else if (raw && typeof raw === "object") {
    metrics = raw as SessionMetrics;
  }
  return {
    ...s,
    metrics,
  };
}

async function persistRegister(s: Session): Promise<void> {
  try {
    await invoke("session_register", { session: s });
  } catch (e) {
    console.warn("session_register failed", e);
  }
}
async function persistStatus(id: string, status: SessionStatus): Promise<void> {
  try {
    await invoke("session_update_status", { id, status });
  } catch (e) {
    console.warn("session_update_status failed", e);
  }
}
async function logEvent(
  sessionId: string,
  kind: string,
  payload?: unknown,
): Promise<void> {
  try {
    await invoke("event_log", { sessionId, kind, payload });
  } catch (e) {
    console.warn("event_log failed", e);
  }
}

class SessionStore {
  private entries = new Map<string, RuntimeEntry>();
  private refitSuspended = false;
  private workspaces = new Map<string, Workspace>();
  private listeners = new Set<Listener>();
  private wsListeners = new Set<Listener>();
  private loaded = false;
  private snapshotCache: Session[] = [];
  private snapshotDirty = true;
  private wsSnapshotCache: Workspace[] = [];
  private wsSnapshotDirty = true;
  private httpInfo: HttpInfo | null = null;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  subscribeWorkspaces = (listener: Listener): (() => void) => {
    this.wsListeners.add(listener);
    return () => {
      this.wsListeners.delete(listener);
    };
  };

  getSnapshot = (): Session[] => {
    if (this.snapshotDirty) {
      this.snapshotCache = Array.from(this.entries.values()).map((e) => ({
        ...e.session,
      }));
      this.snapshotDirty = false;
    }
    return this.snapshotCache;
  };

  getWorkspacesSnapshot = (): Workspace[] => {
    if (this.wsSnapshotDirty) {
      this.wsSnapshotCache = Array.from(this.workspaces.values()).map((w) => ({
        ...w,
      }));
      this.wsSnapshotDirty = false;
    }
    return this.wsSnapshotCache;
  };

  private emit() {
    this.snapshotDirty = true;
    for (const l of this.listeners) l();
  }

  private emitWorkspaces() {
    this.wsSnapshotDirty = true;
    for (const l of this.wsListeners) l();
  }

  private setStatus(id: string, status: SessionStatus) {
    const e = this.entries.get(id);
    if (!e || e.session.status === status) return;
    e.session.status = status;
    e.session.lastActivityAt = Date.now();
    this.emit();
    void persistStatus(id, status);
  }

  private scheduleIdle(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.idleTimer !== null) window.clearTimeout(e.idleTimer);
    e.idleTimer = window.setTimeout(() => {
      if (e.session.status === "running") this.setStatus(id, "idle");
    }, 1500);
  }

  list(): Session[] {
    return this.getSnapshot();
  }

  get(id: string): Session | undefined {
    const e = this.entries.get(id);
    return e ? { ...e.session } : undefined;
  }

  isAlive(id: string): boolean {
    const e = this.entries.get(id);
    return !!e?.pty;
  }

  async bootstrap(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      this.httpInfo = await api.httpInfo();
    } catch (e) {
      console.warn("http_info failed", e);
    }
    try {
      const wss = await api.workspaceList(false);
      for (const w of wss) this.workspaces.set(w.id, w);
      this.emitWorkspaces();
    } catch (e) {
      console.warn("workspace_list failed", e);
    }
    try {
      const persisted = await invoke<Session[]>("session_list");
      for (const raw of persisted) {
        if (this.entries.has(raw.id)) continue;
        const parsed = parsePersistedSession(raw);
        this.entries.set(parsed.id, {
          session: { ...parsed, status: "dead" },
          attached: false,
          idleTimer: null,
        });
      }
      this.emit();
    } catch (e) {
      console.warn("bootstrap session_list failed", e);
    }
    try {
      await listen<HookEvent>("hook-received", (e) => {
        this.onHookReceived(e.payload);
      });
    } catch (e) {
      console.warn("listen hook-received failed", e);
    }
    try {
      await listen<SessionMetricsEvent>("session-metrics", (e) => {
        this.onMetricsReceived(e.payload);
      });
    } catch (e) {
      console.warn("listen session-metrics failed", e);
    }
  }

  private onMetricsReceived(e: SessionMetricsEvent) {
    const entry = this.entries.get(e.sessionId);
    if (!entry) return;
    entry.session.metrics = e.metrics;
    if (e.metrics.model) entry.session.model = e.metrics.model;
    if (e.transcriptPath) entry.session.transcriptPath = e.transcriptPath;
    this.emit();
  }

  getHttpInfo(): HttpInfo | null {
    return this.httpInfo;
  }

  private onHookReceived(e: HookEvent) {
    const trackerId = e.trackerId;
    if (!trackerId) return;
    const entry = this.entries.get(trackerId);
    if (!entry) return;

    // Guarda claudeSessionId na primeira vez que vemos (SessionStart, etc).
    if (e.claudeSessionId && !entry.session.claudeSessionId) {
      entry.session.claudeSessionId = e.claudeSessionId;
    }

    // Timeline de prompts.
    if (e.event === "UserPromptSubmit") {
      const payload = e.payload as { prompt?: string } | null;
      if (payload && typeof payload.prompt === "string") {
        entry.session.lastPrompt = payload.prompt.slice(0, 400);
      }
    }

    const mapped = HOOK_TO_STATUS[e.event];
    if (mapped) {
      this.setStatus(trackerId, mapped);
    } else {
      // Apenas bump activity.
      entry.session.lastActivityAt = Date.now();
      this.emit();
    }
  }

  create(opts: CreateSessionOptions): Session {
    const session = makeSession(opts);

    const spec = CLI_SPEC[opts.cli];
    const file = opts.command ?? spec.file;
    let args = opts.args ?? spec.args;

    // claude --resume <session_id> para continuar conversa.
    if (opts.cli === "claude" && !opts.args) {
      if (opts.resumeClaudeSessionId) {
        args = ["--resume", opts.resumeClaudeSessionId];
        session.claudeSessionId = opts.resumeClaudeSessionId;
      } else if (opts.resumeClaudeContinue) {
        args = ["--continue"];
      }
    }

    // Em bundles (AppImage/.deb) o processo herda uma PATH mínima do desktop
    // environment, sem `~/.local/bin`, nvm, etc. Sem PATH correta, binários
    // como `claude` não são encontrados e o PTY morre sem feedback.
    const userPath =
      this.httpInfo?.userPath && this.httpInfo.userPath.length > 0
        ? this.httpInfo.userPath
        : undefined;
    const env: Record<string, string> = {
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      AGTX_SESSION_TRACKER: session.id,
      ...(userPath ? { PATH: userPath } : {}),
      ...(opts.cli === "claude" ? { CLAUDE_CODE_NO_FLICKER: "1" } : {}),
      ...(this.httpInfo
        ? {
            AGTX_HOOK_PORT: String(this.httpInfo.port),
            AGTX_HOOK_SECRET: this.httpInfo.secret,
          }
        : {}),
      ...opts.env,
    };

    let pty: IPty;
    try {
      pty = spawn(file, args, {
        cols: 80,
        rows: 24,
        cwd: opts.cwd,
        env,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("spawn failed", { file, args, cwd: opts.cwd, error: msg });
      throw new Error(`Falha ao iniciar ${file}: ${msg}`);
    }
    session.pid = pty.pid;

    const term = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily:
        "'JetBrains Mono', 'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.3,
      theme: TERM_THEME,
      scrollback: 10000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(serialize);

    const entry: RuntimeEntry = {
      session,
      pty,
      term,
      fit,
      serialize,
      attached: false,
      idleTimer: null,
    };

    const decoder = new TextDecoder();
    pty.onData((data) => {
      term.write(data);
      const e = this.entries.get(session.id);
      if (!e) return;
      e.session.lastActivityAt = Date.now();

      // Para CLIs governadas por hooks (Claude Code), o status vem
      // exclusivamente de eventos hook. Output do PTY — incluindo o eco de
      // digitação — NÃO muda status. Apenas atualiza lastActivityAt e, se
      // ainda estiver em "starting", cai para "idle" para não ficar eterno
      // caso hooks não estejam instalados.
      if (HOOK_DRIVEN_CLIS.has(session.cli)) {
        if (e.session.status === "starting") {
          this.setStatus(session.id, "idle");
        } else {
          this.emit();
        }
        return;
      }

      // Heurística para TUIs sem hooks: só considera "running" quando há
      // sinal forte (spinner). Caso contrário, apenas agenda verificação
      // de idle — assim digitar no shell não mascara como "rodando".
      const chunk = decoder.decode(data, { stream: true });
      if (SPINNER_RE.test(chunk)) {
        if (e.session.status !== "running") {
          this.setStatus(session.id, "running");
        }
      } else if (e.session.status === "starting") {
        this.setStatus(session.id, "idle");
      } else {
        this.emit();
      }
      this.scheduleIdle(session.id);
    });

    term.onData((data) => {
      pty.write(data);
    });

    term.onResize(({ cols, rows }) => {
      try {
        pty.resize(cols, rows);
      } catch (err) {
        console.warn("pty.resize failed", err);
      }
    });

    pty.onExit(({ exitCode }) => {
      const e = this.entries.get(session.id);
      if (!e) return;
      e.pty = undefined;
      this.setStatus(session.id, exitCode === 0 ? "done" : "error");
      void logEvent(session.id, "exit", { exitCode });
      // Deixa visível no terminal o motivo de encerramento — em builds
      // empacotados um "comando não encontrado" ou erro silencioso some sem
      // feedback, deixando o xterm em branco.
      try {
        const hint =
          exitCode === 127
            ? `\r\n\x1b[31m[agtx] comando não encontrado: ${file}\x1b[0m`
            : exitCode === 0
            ? `\r\n\x1b[90m[agtx] processo encerrado (exit 0)\x1b[0m`
            : `\r\n\x1b[31m[agtx] processo encerrado (exit ${exitCode})\x1b[0m`;
        e.term?.write(hint);
      } catch {}
    });

    this.entries.set(session.id, entry);
    this.emit();
    void persistRegister(session);

    // Fallback de boot: se após 5s ainda estiver em "starting" (sem hook e
    // sem output), considera idle para não travar a UI.
    window.setTimeout(() => {
      const e = this.entries.get(session.id);
      if (e && e.session.status === "starting") {
        this.setStatus(session.id, "idle");
      }
    }, 5000);

    return { ...session };
  }

  attach(id: string, element: HTMLElement) {
    const e = this.entries.get(id);
    if (!e || !e.term || e.attached) return;
    e.term.open(element);
    e.fit?.fit();
    if (e.pty) {
      try {
        e.pty.resize(e.term.cols, e.term.rows);
      } catch {}
    }
    e.attached = true;
  }

  refit(id: string) {
    if (this.refitSuspended) return;
    const e = this.entries.get(id);
    if (!e || !e.attached || !e.term || !e.fit) return;
    try {
      const buf = e.term.buffer.active;
      const distanceFromBottom = buf.baseY - buf.viewportY;
      e.fit.fit();
      if (distanceFromBottom === 0) {
        e.term.scrollToBottom();
      } else {
        const nextBuf = e.term.buffer.active;
        const targetY = Math.max(0, nextBuf.baseY - distanceFromBottom);
        e.term.scrollToLine(targetY);
      }
    } catch {}
  }

  setRefitSuspended(v: boolean) {
    this.refitSuspended = v;
  }

  focus(id: string) {
    const e = this.entries.get(id);
    if (!e?.term) return;
    queueMicrotask(() => {
      try {
        e.term!.focus();
      } catch {}
    });
  }

  sendInput(id: string, data: string) {
    const e = this.entries.get(id);
    e?.pty?.write(data);
  }

  sendSignal(id: string, signal: "SIGINT" | "SIGTERM" = "SIGINT") {
    const e = this.entries.get(id);
    if (!e?.pty) return;
    if (signal === "SIGINT") e.pty.write("\x03");
    else e.pty.kill("SIGTERM");
  }

  /** Mata o PTY e marca sessão como 'dead' (mantém no histórico). */
  kill(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.pty) {
      try {
        e.pty.kill();
      } catch {}
      e.pty = undefined;
    }
    this.setStatus(id, "dead");
  }

  getWorkspace(id: string | null | undefined): Workspace | undefined {
    if (!id) return undefined;
    return this.workspaces.get(id);
  }

  /** Procura entry viva com o claudeSessionId indicado. */
  findLiveClaudeEntry(claudeSessionId: string): Session | undefined {
    for (const e of this.entries.values()) {
      if (
        e.session.cli === "claude" &&
        e.session.claudeSessionId === claudeSessionId &&
        e.pty
      ) {
        return { ...e.session };
      }
    }
    return undefined;
  }

  /** Abre/retoma uma conversa Claude específica. Reutiliza PTY vivo se houver. */
  openClaudeConversation(opts: {
    cwd: string;
    claudeSessionId: string;
    workspaceId: string | null;
  }): Session {
    const existing = this.findLiveClaudeEntry(opts.claudeSessionId);
    if (existing) return existing;
    return this.create({
      cli: "claude",
      cwd: opts.cwd,
      workspaceId: opts.workspaceId,
      resumeClaudeSessionId: opts.claudeSessionId,
    });
  }

  async moveSession(sessionId: string, workspaceId: string | null) {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.session.workspaceId = workspaceId;
    entry.session.lastActivityAt = Date.now();
    this.emit();
    try {
      await api.sessionMove(sessionId, workspaceId);
    } catch (e) {
      console.warn("sessionMove failed", e);
    }
  }

  async workspaceCreate(input: WorkspaceCreateInput): Promise<Workspace> {
    const ws = await api.workspaceCreate(input);
    this.workspaces.set(ws.id, ws);
    this.emitWorkspaces();
    return ws;
  }

  async workspaceUpdate(
    id: string,
    patch: WorkspaceUpdateInput,
  ): Promise<Workspace> {
    const ws = await api.workspaceUpdate(id, patch);
    this.workspaces.set(ws.id, ws);
    this.emitWorkspaces();
    return ws;
  }

  async workspaceArchive(id: string): Promise<void> {
    await api.workspaceArchive(id);
    this.workspaces.delete(id);
    // Sessões que ficaram com workspace_id órfão: nada a fazer, UI vai
    // mostrar como Inbox (getWorkspace retorna undefined).
    this.emitWorkspaces();
  }

  /** Remove sessão da RAM e do DB. */
  async remove(id: string): Promise<void> {
    const e = this.entries.get(id);
    if (!e) return;
    if (e.pty) {
      try {
        e.pty.kill();
      } catch {}
    }
    if (e.term) {
      try {
        e.term.dispose();
      } catch {}
    }
    if (e.idleTimer !== null) window.clearTimeout(e.idleTimer);
    this.entries.delete(id);
    this.emit();
    try {
      await invoke("session_delete", { id });
    } catch (err) {
      console.warn("session_delete failed", err);
    }
  }
}

export const store = new SessionStore();
