import { Button } from "@/components/ui/button";
import { SessionCard } from "./SessionCard";
import type { Session, Workspace } from "@/lib/tauri";
import { Plus } from "lucide-react";

interface Props {
  sessions: Session[];
  workspaces: Workspace[];
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function Dashboard({ sessions, workspaces, onSelect, onNew }: Props) {
  const wsById = new Map(workspaces.map((w) => [w.id, w] as const));

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            Todas as sessões ativas, priorizadas por urgência.
          </p>
        </div>
        <Button onClick={onNew} size="sm">
          <Plus className="size-4" /> Nova sessão
        </Button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        {sessions.length === 0 ? (
          <EmptyState onNew={onNew} />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                workspace={s.workspaceId ? wsById.get(s.workspaceId) : undefined}
                onClick={() => onSelect(s.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
      <div className="size-12 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5" />
      <div>
        <h2 className="text-base font-medium">Sem sessões ainda</h2>
        <p className="text-sm text-muted-foreground">
          Crie uma sessão para começar a orquestrar seus agentes.
        </p>
      </div>
      <Button onClick={onNew}>
        <Plus className="size-4" /> Nova sessão
      </Button>
    </div>
  );
}
