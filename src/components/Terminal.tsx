import type { Session, Workspace } from "@/lib/tauri";
import { STATUS_META } from "@/lib/status";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { History, RotateCcw, Sparkles, Square, Trash2, X } from "lucide-react";
import { store } from "@/lib/runtime";
import { wsColorVar } from "@/lib/workspaceColors";

interface Props {
  session: Session;
  workspace?: Workspace;
  onClose: () => void;
  onSelect: (id: string) => void;
}

const ALIVE: ReadonlyArray<Session["status"]> = [
  "starting",
  "running",
  "idle",
  "waiting-input",
  "needs-attention",
];

export function TerminalHeader({ session, workspace, onClose, onSelect }: Props) {
  const meta = STATUS_META[session.status];
  const isAlive = ALIVE.includes(session.status);
  const isClaude = session.cli === "claude";
  const canResumeExact = isClaude && !!session.claudeSessionId;
  const canResumeContinue = isClaude && !session.claudeSessionId;

  const spawn = (extra: {
    resumeClaudeSessionId?: string;
    resumeClaudeContinue?: boolean;
  }) => {
    const { cli, cwd, workspaceId } = session;
    const created = store.create({ cli, cwd, workspaceId, ...extra });
    onSelect(created.id);
  };

  const restartFresh = () => spawn({});
  const restartResumeExact = () =>
    spawn({ resumeClaudeSessionId: session.claudeSessionId! });
  const restartResumeContinue = () => spawn({ resumeClaudeContinue: true });

  return (
    <header className="flex items-center justify-between border-b px-4 py-2 bg-card/40">
      <div className="flex items-center gap-3 min-w-0">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide shrink-0",
            meta.chipClass,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dotClass)} />
          {meta.label}
        </span>
        {workspace && (
          <span className="inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground shrink-0">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: wsColorVar(workspace.color) }}
            />
            {workspace.name}
          </span>
        )}
        <span className="font-mono text-sm truncate">{session.cli}</span>
        <span className="text-xs text-muted-foreground font-mono truncate">
          {session.cwd}
        </span>
        {session.pid != null && isAlive && (
          <span className="text-[10px] text-muted-foreground font-mono shrink-0">
            pid {session.pid}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {isAlive && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Enviar Ctrl-C"
              onClick={() => store.sendSignal(session.id, "SIGINT")}
            >
              <Square className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Matar sessão"
              onClick={() => store.kill(session.id)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </>
        )}
        {isClaude ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" title="Reiniciar">
                <RotateCcw className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canResumeExact && (
                <DropdownMenuItem onClick={restartResumeExact}>
                  <History className="size-3.5" />
                  Retomar esta conversa
                </DropdownMenuItem>
              )}
              {canResumeContinue && (
                <DropdownMenuItem onClick={restartResumeContinue}>
                  <History className="size-3.5" />
                  Retomar última conversa
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={restartFresh}>
                <Sparkles className="size-3.5" />
                Nova conversa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            variant="ghost"
            size="icon-sm"
            title={isAlive ? "Reiniciar" : "Reabrir com mesmo cwd"}
            onClick={restartFresh}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        )}
        {!isAlive && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Remover do histórico"
            onClick={() => {
              void store.remove(session.id);
              onClose();
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title="Voltar ao dashboard"
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}
