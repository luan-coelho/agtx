import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { wsColorVar } from "@/lib/workspaceColors";
import { useTasks } from "@/hooks/useTasks";
import { useLabels } from "@/hooks/useLabels";
import { useSessions } from "@/hooks/useSessions";
import { store } from "@/lib/runtime";
import type { SessionStatus } from "@/lib/status";
import { TaskRow } from "./TaskRow";
import { Button } from "@/components/ui/button";
import type { TaskStatus, Workspace } from "@/lib/tauri";
import { X, Plus } from "lucide-react";

interface Props {
  workspaces: Workspace[];
  workspaceFilter: string | null;
  onSelectWorkspace: (id: string | null) => void;
  onOpenSession: (id: string) => void;
  onNewSession?: () => void;
  /** ID da sessão (PTY) atualmente ativa na aba — para destacar a row correspondente. */
  activeSessionId?: string | null;
}

const SECTION_ORDER: { key: TaskStatus; label: string; color: string }[] = [
  { key: "backlog", label: "Backlog", color: "var(--status-attention)" },
  { key: "planning", label: "Planning & Implementation", color: "var(--status-running)" },
  { key: "done", label: "Done", color: "var(--status-done)" },
];

export function TaskBoard({
  workspaces,
  workspaceFilter,
  onSelectWorkspace,
  onOpenSession,
  onNewSession,
  activeSessionId,
}: Props) {
  const { views, loading, refresh } = useTasks(workspaces, workspaceFilter);
  const { labels } = useLabels();
  const { sessions } = useSessions();

  // Map reativo: claudeSessionId → status da sessão PTY viva.
  // Usado para exibir indicador de "precisa atenção" (confirmação pendente) e
  // outros estados em tempo real no TaskRow.
  const liveStatusByClaudeId = useMemo(() => {
    const m = new Map<string, SessionStatus>();
    for (const s of sessions) {
      if (s.cli !== "claude" || !s.claudeSessionId) continue;
      if (!store.isAlive(s.id)) continue;
      const prev = m.get(s.claudeSessionId);
      // Se houver várias, prioriza a mais "urgente".
      if (!prev || statusUrgency(s.status) > statusUrgency(prev)) {
        m.set(s.claudeSessionId, s.status);
      }
    }
    return m;
  }, [sessions]);

  const wsById = useMemo(
    () => new Map(workspaces.map((w) => [w.id, w] as const)),
    [workspaces],
  );

  const grouped = useMemo(() => {
    const g: Record<TaskStatus, typeof views> = {
      backlog: [],
      planning: [],
      done: [],
    };
    for (const v of views) {
      const status = v.task.status as TaskStatus;
      if (g[status]) g[status].push(v);
    }
    return g;
  }, [views]);

  const openTask = async (claudeSessionId: string, cwd: string, workspaceId: string) => {
    const opened = store.openClaudeConversation({
      cwd,
      claudeSessionId,
      workspaceId,
    });
    onOpenSession(opened.id);
  };

  // Mapeia claudeSessionId → sessionId ativo (PTY rodando) para destacar row.
  const activeClaudeIds = useMemo(() => {
    const ids = new Set<string>();
    const snapshot = store.list();
    for (const s of snapshot) {
      if (s.id === activeSessionId && s.claudeSessionId) {
        ids.add(s.claudeSessionId);
      }
    }
    return ids;
  }, [activeSessionId, views]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-2 overflow-x-auto px-4 py-2 border-b">
        <div className="flex items-center gap-2 overflow-x-auto min-w-0">
          <TabButton
            active={workspaceFilter === null}
            onClick={() => onSelectWorkspace(null)}
            onClose={undefined}
          >
            All
          </TabButton>
          {workspaces.map((ws) => (
            <TabButton
              key={ws.id}
              active={workspaceFilter === ws.id}
              onClick={() => onSelectWorkspace(ws.id)}
              onClose={
                workspaceFilter === ws.id
                  ? () => onSelectWorkspace(null)
                  : undefined
              }
              color={wsColorVar(ws.color)}
            >
              {ws.name}
            </TabButton>
          ))}
        </div>
        {onNewSession && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={onNewSession}
            title="Nova sessão"
            className="shrink-0"
          >
            <Plus className="size-4" />
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-auto px-4 py-3">
        {loading && views.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            Carregando tarefas…
          </div>
        ) : views.length === 0 ? (
          <EmptyState onNewSession={onNewSession} />
        ) : (
          SECTION_ORDER.map(({ key, label, color }) => {
            const items = grouped[key];
            if (items.length === 0) return null;
            return (
              <section key={key} className="mb-4">
                <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                  <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="font-medium" style={{ color }}>{label}</span>
                  <span className="font-mono">{items.length}</span>
                </div>
                <div className="rounded-md border bg-card/20">
                  {items.map((v) => {
                    const ws = wsById.get(v.task.workspaceId);
                    return (
                      <TaskRow
                        key={v.task.id}
                        task={v.task}
                        title={v.title}
                        workspace={ws}
                        showWorkspace={workspaceFilter === null}
                        labels={labels}
                        liveStatus={liveStatusByClaudeId.get(v.task.claudeSessionId) ?? null}
                        active={activeClaudeIds.has(v.task.claudeSessionId)}
                        onOpen={() => {
                          if (ws) {
                            void openTask(v.task.claudeSessionId, ws.rootCwd, ws.id);
                          }
                        }}
                        onChanged={refresh}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

function statusUrgency(s: SessionStatus): number {
  switch (s) {
    case "needs-attention":
      return 5;
    case "waiting-input":
      return 4;
    case "running":
      return 3;
    case "starting":
      return 2;
    case "idle":
      return 1;
    default:
      return 0;
  }
}

function TabButton({
  active,
  onClick,
  onClose,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shrink-0 transition-colors",
        active
          ? "bg-accent border-accent-foreground/20"
          : "border-transparent hover:bg-accent/40",
      )}
    >
      <button onClick={onClick} className="flex items-center gap-1.5">
        {color && (
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="font-mono">{children}</span>
      </button>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

function EmptyState({ onNewSession }: { onNewSession?: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 py-12 text-center">
      <div className="size-10 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5" />
      <div>
        <h2 className="text-sm font-medium">Sem tarefas ainda</h2>
        <p className="text-xs text-muted-foreground">
          Abra uma conversa com Claude Code para criar sua primeira tarefa.
        </p>
      </div>
      {onNewSession && (
        <Button
          onClick={onNewSession}
          size="sm"
          className="mt-2"
        >
          <Plus className="size-4" /> Nova sessão
        </Button>
      )}
    </div>
  );
}
