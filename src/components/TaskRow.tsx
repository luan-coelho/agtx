import { useEffect, useRef, useState } from "react";
import { Diamond, Loader2, Circle, CheckCircle2, X, Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { wsColorVar } from "@/lib/workspaceColors";
import type { SessionStatus } from "@/lib/status";
import {
  api,
  type Label,
  type Task,
  type TaskStatus,
  type Workspace,
} from "@/lib/tauri";

interface Props {
  task: Task;
  title: string;
  workspace?: Workspace;
  showWorkspace?: boolean;
  labels: Label[];
  active?: boolean;
  /** Status da sessão PTY viva vinculada (null se não há sessão rodando). */
  liveStatus?: SessionStatus | null;
  onOpen: () => void;
  onChanged: () => void;
}

export function TaskRow({
  task,
  title,
  workspace,
  showWorkspace,
  labels,
  active,
  liveStatus,
  onOpen,
  onChanged,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      setDraft(title);
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [editing, title]);

  const saveTitle = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next === title) return;
    try {
      await api.taskUpdateTitle(
        task.claudeSessionId,
        next.length > 0 ? next : null,
      );
      onChanged();
    } catch {}
  };

  const setStatus = async (status: TaskStatus) => {
    try {
      await api.taskUpdateStatus(task.claudeSessionId, status);
      onChanged();
    } catch {}
  };

  const setLabel = async (labelId: string | null) => {
    try {
      await api.taskUpdateLabel(task.claudeSessionId, labelId);
      onChanged();
    } catch {}
  };

  const remove = async () => {
    try {
      await api.taskDelete(task.claudeSessionId);
      onChanged();
    } catch {}
  };

  const current = task.label
    ? labels.find((l) => l.id === task.label) ?? null
    : null;

  return (
    <div
      className={cn(
        "group flex items-start gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        "border-b border-border/40 last:border-b-0",
        active ? "bg-accent/60" : "hover:bg-accent/30",
      )}
    >
      <span className="font-mono text-[11px] text-muted-foreground tabular-nums w-12 shrink-0 pt-0.5">
        #{task.seq}
      </span>
      <Diamond
        className={cn(
          "size-3.5 shrink-0 mt-1",
          task.status === "done"
            ? "text-[var(--status-done)]"
            : task.status === "planning"
            ? "text-[var(--status-running)]"
            : "text-[var(--status-attention)]",
        )}
      />

      <button
        onClick={onOpen}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
        className="flex-1 min-w-0 text-left"
      >
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") saveTitle();
              if (e.key === "Escape") {
                setEditing(false);
                setDraft(title);
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full bg-transparent outline-none text-foreground font-mono text-sm"
          />
        ) : (
          <span className="block break-words text-foreground/90 group-hover:text-foreground">
            {title}
          </span>
        )}
      </button>

      {(liveStatus === "needs-attention" || liveStatus === "waiting-input") && (
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono shrink-0",
            liveStatus === "needs-attention"
              ? "text-[var(--status-attention)] border-[var(--status-attention)]/40 bg-[var(--status-attention)]/10 animate-pulse"
              : "text-[var(--status-waiting)] border-[var(--status-waiting)]/40 bg-[var(--status-waiting)]/10",
          )}
          title={
            liveStatus === "needs-attention"
              ? "Aguardando confirmação do usuário"
              : "Aguardando input"
          }
        >
          <Bell className="size-2.5" />
          {liveStatus === "needs-attention" ? "confirmar" : "input"}
        </span>
      )}

      {showWorkspace && workspace && (
        <span className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shrink-0">
          <span
            className="size-1.5 rounded-full"
            style={{ backgroundColor: wsColorVar(workspace.color) }}
          />
          {workspace.name}
        </span>
      )}

      <LabelChip current={current} labels={labels} onChange={setLabel} />

      <StatusDot status={task.status} onChange={setStatus} />

      <button
        onClick={remove}
        title="Remover do quadro"
        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-[var(--status-error)]"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function LabelChip({
  current,
  labels,
  onChange,
}: {
  current: Label | null;
  labels: Label[];
  onChange: (id: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] shrink-0",
            "hover:bg-accent/40",
            current ? "" : "border-dashed text-muted-foreground/60",
          )}
          style={
            current
              ? {
                  color: wsColorVar(current.color),
                  borderColor: wsColorVar(current.color),
                }
              : undefined
          }
          title="Definir label"
        >
          {current ? (
            <>
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: wsColorVar(current.color) }}
              />
              {current.name}
            </>
          ) : (
            "sem label"
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {labels.length === 0 && (
          <DropdownMenuItem disabled>
            Sem labels cadastrados
          </DropdownMenuItem>
        )}
        {labels.map((l) => (
          <DropdownMenuItem key={l.id} onClick={() => onChange(l.id)}>
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: wsColorVar(l.color) }}
            />
            {l.name}
          </DropdownMenuItem>
        ))}
        {current && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)}>
              Remover label
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusDot({
  status,
  onChange,
}: {
  status: TaskStatus;
  onChange: (s: TaskStatus) => void;
}) {
  const icon =
    status === "done" ? (
      <CheckCircle2 className="size-4 text-[var(--status-done)]" />
    ) : status === "planning" ? (
      <Loader2 className="size-4 animate-spin text-[var(--status-running)]" />
    ) : (
      <Circle className="size-4 text-muted-foreground" />
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 rounded hover:bg-accent/40 p-0.5"
          title={`Status: ${status}`}
        >
          {icon}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onChange("backlog")}>
          <Circle className="size-3.5 text-muted-foreground" />
          Backlog
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange("planning")}>
          <Loader2 className="size-3.5 text-[var(--status-running)]" />
          Planning &amp; Implementation
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange("done")}>
          <CheckCircle2 className="size-3.5 text-[var(--status-done)]" />
          Done
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
