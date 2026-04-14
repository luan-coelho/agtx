import { invoke } from "@tauri-apps/api/core";
import type { SessionStatus } from "./status";

export type Cli = "claude" | "codex" | "opencode" | "shell";

export const WORKSPACE_COLORS = [
  "lime",
  "sky",
  "violet",
  "amber",
  "rose",
  "emerald",
  "cyan",
  "fuchsia",
] as const;
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

export interface Workspace {
  id: string;
  name: string;
  rootCwd: string;
  defaultCli: Cli | null;
  color: WorkspaceColor;
  createdAt: number;
  archivedAt: number | null;
}

export interface WorkspaceCreateInput {
  name: string;
  rootCwd: string;
  defaultCli?: Cli | null;
  color?: WorkspaceColor;
}

export interface WorkspaceUpdateInput {
  name?: string;
  rootCwd?: string;
  defaultCli?: Cli | null;
  color?: WorkspaceColor;
}

export interface SessionMetrics {
  model: string | null;
  contextTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  messageCount: number;
  firstMessageAtMs: number | null;
  lastMessageAtMs: number | null;
}

export interface Session {
  id: string;
  cli: Cli;
  cwd: string;
  workspaceId: string | null;
  status: SessionStatus;
  claudeSessionId: string | null;
  createdAt: number;
  lastActivityAt: number;
  pid: number | null;
  lastPrompt: string | null;
  model: string | null;
  transcriptPath: string | null;
  metrics: SessionMetrics | null;
}

export interface SessionMetricsEvent {
  sessionId: string;
  metrics: SessionMetrics;
  transcriptPath: string | null;
}

export interface CreateSessionOptions {
  cli: Cli;
  cwd: string;
  workspaceId?: string | null;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** Para cli=claude: retoma conversa existente via `claude --resume <id>`. */
  resumeClaudeSessionId?: string | null;
  /** Para cli=claude sem id conhecido: `claude --continue` retoma a última
   *  conversa daquele cwd. */
  resumeClaudeContinue?: boolean;
}

export interface HttpInfo {
  port: number;
  secret: string;
}

export interface HooksStatus {
  installed: boolean;
  settingsPath: string;
  installedEvents: string[];
}

export interface HookEvent {
  trackerId: string | null;
  claudeSessionId: string | null;
  event: string;
  cwd: string | null;
  transcriptPath: string | null;
  payload: unknown;
  receivedAtMs: number;
}

export type TaskStatus = "backlog" | "planning" | "done";

/** Label armazenada no DB; user pode criar/editar/remover. */
export interface Label {
  id: string;
  name: string;
  color: string; // slug da paleta WORKSPACE_COLORS
  createdAt: number;
}

export interface LabelCreateInput {
  name: string;
  color: string;
}

export interface LabelUpdateInput {
  name?: string;
  color?: string;
}

export interface Task {
  id: number;
  workspaceId: string;
  claudeSessionId: string;
  seq: number;
  titleOverride: string | null;
  /** id do label (FK lógica para labels.id), null se nenhum. */
  status: TaskStatus;
  label: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface ClaudeSessionSummary {
  id: string;
  modifiedAtMs: number;
  /** Título resolvido: custom-title > último last-prompt > primeiro prompt. */
  title: string | null;
  customTitle: string | null;
  lastPrompt: string | null;
  firstUserPrompt: string | null;
  lineCount: number;
  sizeBytes: number;
}

export const api = {
  httpInfo: () => invoke<HttpInfo>("http_info"),
  hooksStatus: () => invoke<HooksStatus>("hooks_status"),
  hooksInstall: () => invoke<HooksStatus>("hooks_install"),
  hooksUninstall: () => invoke<HooksStatus>("hooks_uninstall"),

  workspaceCreate: (input: WorkspaceCreateInput) =>
    invoke<Workspace>("workspace_create", { input }),
  workspaceList: (includeArchived = false) =>
    invoke<Workspace[]>("workspace_list", { includeArchived }),
  workspaceUpdate: (id: string, patch: WorkspaceUpdateInput) =>
    invoke<Workspace>("workspace_update", { id, patch }),
  workspaceArchive: (id: string) =>
    invoke<Workspace>("workspace_archive", { id }),
  workspaceUnarchive: (id: string) =>
    invoke<Workspace>("workspace_unarchive", { id }),
  workspaceDelete: (id: string) => invoke<void>("workspace_delete", { id }),
  sessionMove: (id: string, workspaceId: string | null) =>
    invoke<void>("session_move", { id, workspaceId }),

  claudeSessionsForCwd: (cwd: string) =>
    invoke<ClaudeSessionSummary[]>("claude_sessions_for_cwd", { cwd }),

  taskEnsure: (
    workspaceId: string,
    claudeSessionId: string,
    status?: TaskStatus,
  ) =>
    invoke<Task>("task_ensure", {
      workspaceId,
      claudeSessionId,
      status,
    }),
  taskList: (workspaceId?: string | null) =>
    invoke<Task[]>("task_list", { workspaceId: workspaceId ?? null }),
  taskUpdateStatus: (claudeSessionId: string, status: TaskStatus) =>
    invoke<Task>("task_update_status", { claudeSessionId, status }),
  taskUpdateLabel: (claudeSessionId: string, label: string | null) =>
    invoke<Task>("task_update_label", { claudeSessionId, label }),

  labelList: () => invoke<Label[]>("label_list"),
  labelCreate: (input: LabelCreateInput) =>
    invoke<Label>("label_create", { input }),
  labelUpdate: (id: string, patch: LabelUpdateInput) =>
    invoke<Label>("label_update", { id, patch }),
  labelDelete: (id: string) => invoke<void>("label_delete", { id }),
  taskUpdateTitle: (claudeSessionId: string, title: string | null) =>
    invoke<Task>("task_update_title", { claudeSessionId, title }),
  taskDelete: (claudeSessionId: string) =>
    invoke<void>("task_delete", { claudeSessionId }),
};
