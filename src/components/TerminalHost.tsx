import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { store } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { ClaudeResumePicker } from "./ClaudeResumePicker";
import type { Session } from "@/lib/tauri";

interface DeadSlotProps {
  session: Session;
  onSelect: (id: string) => void;
}

interface Props {
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function TerminalHost({ sessions, activeId, onSelect }: Props) {
  return (
    <div className="relative h-full w-full bg-background">
      {sessions.map((s) => (
        <TerminalSlot
          key={s.id}
          session={s}
          active={s.id === activeId}
          onSelect={onSelect}
        />
      ))}
      {sessions.length === 0 && (
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Nenhuma sessão ativa.
        </div>
      )}
    </div>
  );
}

function TerminalSlot({
  session,
  active,
  onSelect,
}: {
  session: Session;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isAlive = store.isAlive(session.id);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isAlive) return;
    store.attach(session.id, el);
  }, [session.id, isAlive]);

  useEffect(() => {
    if (!active || !isAlive) return;

    // Aguarda o próximo frame de pintura para que o browser já tenha
    // aplicado visibility:visible e o container tenha dimensões corretas
    // antes de fit.fit() medir cols/rows. Sem isso, xterm fica preto.
    let raf = requestAnimationFrame(() => {
      store.refit(session.id);
      store.focus(session.id);
    });

    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => store.refit(session.id));
    };
    window.addEventListener("resize", onResize);

    const el = containerRef.current;
    let ro: ResizeObserver | undefined;
    if (el && "ResizeObserver" in window) {
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => store.refit(session.id));
      });
      ro.observe(el);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [active, session.id, isAlive]);

  return (
    <div
      className={cn(
        "absolute inset-0",
        active ? "visible z-10" : "invisible z-0",
      )}
    >
      {isAlive ? (
        <div ref={containerRef} className="h-full w-full px-3 pb-3 pt-2" />
      ) : (
        <DeadSlot session={session} onSelect={onSelect} />
      )}
    </div>
  );
}

function DeadSlot({ session, onSelect }: DeadSlotProps) {
  const isClaude = session.cli === "claude";

  const spawn = (extra: { resumeClaudeSessionId?: string }) => {
    const created = store.create({
      cli: session.cli,
      cwd: session.cwd,
      workspaceId: session.workspaceId,
      ...extra,
    });
    onSelect(created.id);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center text-muted-foreground">
      <div className="font-mono text-xs">
        {session.cli} · {session.cwd}
      </div>
      <div className="text-sm">
        Sessão encerrada
        {session.status === "error" ? " com erro" : ""}.
      </div>
      {isClaude ? (
        <ClaudeResumePicker
          cwd={session.cwd}
          currentId={session.claudeSessionId}
          ownId={session.claudeSessionId}
          onResume={(id) => spawn({ resumeClaudeSessionId: id })}
          onFresh={() => spawn({})}
        />
      ) : (
        <Button size="sm" onClick={() => spawn({})}>
          <Sparkles className="size-4" />
          Nova conversa
        </Button>
      )}
    </div>
  );
}
