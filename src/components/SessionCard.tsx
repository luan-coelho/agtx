import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/status";
import { wsColorVar } from "@/lib/workspaceColors";
import type { Session, Workspace } from "@/lib/tauri";
import { Clock, Folder, Sparkles, Terminal as TerminalIcon } from "lucide-react";

const CLI_ICON = {
  claude: Sparkles,
  codex: Sparkles,
  opencode: Sparkles,
  shell: TerminalIcon,
} as const;

function relative(ts: number) {
  const delta = Date.now() - ts;
  const s = Math.round(delta / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m}m`;
  const h = Math.round(m / 60);
  return `há ${h}h`;
}

function shortCwd(cwd: string) {
  return cwd.replace(/^\/home\/[^/]+/, "~");
}

interface Props {
  session: Session;
  workspace?: Workspace;
  active?: boolean;
  onClick?: () => void;
}

export function SessionCard({ session, workspace, active, onClick }: Props) {
  const meta = STATUS_META[session.status];
  const Icon = CLI_ICON[session.cli];

  return (
    <Card
      onClick={onClick}
      className={cn(
        "group cursor-pointer p-4 gap-3 transition-all hover:border-primary/40 hover:bg-accent/30",
        active && "border-primary/60 bg-accent/40",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-mono text-sm truncate">{session.cli}</span>
          {workspace && (
            <span className="inline-flex items-center gap-1.5 rounded-full border px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
              <span
                className="size-1.5 rounded-full"
                style={{ backgroundColor: wsColorVar(workspace.color) }}
              />
              {workspace.name}
            </span>
          )}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            meta.chipClass,
          )}
        >
          <span className={cn("size-1.5 rounded-full", meta.dotClass)} />
          {meta.label}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Folder className="size-3" />
        <span className="truncate">{shortCwd(session.cwd)}</span>
      </div>

      {session.lastPrompt && (
        <p className="text-xs text-foreground/80 line-clamp-2 leading-relaxed">
          {session.lastPrompt}
        </p>
      )}

      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="size-3" />
        <span>{relative(session.lastActivityAt)}</span>
      </div>
    </Card>
  );
}
