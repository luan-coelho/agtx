import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/status";
import type { Session, Task } from "@/lib/tauri";
import { Diamond, X } from "lucide-react";

interface OpenTab {
  sessionId: string;
  session?: Session;
  task?: Task;
  title: string;
}

interface Props {
  tabs: OpenTab[];
  activeId: string | null;
  onActivate: (sessionId: string) => void;
  onClose: (sessionId: string) => void;
}

export function TerminalTabs({ tabs, activeId, onActivate, onClose }: Props) {
  if (tabs.length === 0) return null;
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b bg-card/40 px-2 py-1">
      {tabs.map((t) => {
        const active = t.sessionId === activeId;
        const meta = t.session ? STATUS_META[t.session.status] : null;
        return (
          <div
            key={t.sessionId}
            className={cn(
              "group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs shrink-0 transition-colors",
              active
                ? "bg-accent border-accent-foreground/20"
                : "border-transparent hover:bg-accent/40",
            )}
          >
            <button
              onClick={() => onActivate(t.sessionId)}
              className="flex items-center gap-1.5 min-w-0"
            >
              <Diamond className="size-3 shrink-0 text-muted-foreground/70" />
              {t.task && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  #{t.task.seq}
                </span>
              )}
              <span className="font-mono truncate max-w-[160px]">
                {t.title}
              </span>
              {meta && (
                <span
                  className={cn("size-1.5 shrink-0 rounded-full", meta.dotClass)}
                />
              )}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.sessionId);
              }}
              className="text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
