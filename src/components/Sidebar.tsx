import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { wsColorVar } from "@/lib/workspaceColors";
import type { Workspace } from "@/lib/tauri";
import {
  Archive,
  LayoutDashboard,
  MoreVertical,
  Pencil,
  Plus,
  Settings,
} from "lucide-react";

interface Props {
  workspaces: Workspace[];
  workspaceFilter: string | null;
  onSelectWorkspace: (id: string | null) => void;
  onNew: () => void;
  onOpenSettings: () => void;
  onOpenDashboard: () => void;
  dashboardActive: boolean;
  settingsActive: boolean;
  onNewWorkspace: () => void;
  onEditWorkspace: (ws: Workspace) => void;
  onArchiveWorkspace: (ws: Workspace) => void;
}

export function Sidebar({
  workspaces,
  workspaceFilter,
  onSelectWorkspace,
  onNew,
  onOpenSettings,
  onOpenDashboard,
  dashboardActive,
  settingsActive,
  onNewWorkspace,
  onEditWorkspace,
  onArchiveWorkspace,
}: Props) {
  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r bg-card/40">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-gradient-to-br from-primary to-primary/40" />
          <span className="font-mono text-sm font-semibold tracking-tight">
            agtx
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            v0.1
          </span>
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onNew}
          title="Nova sessão"
        >
          <Plus className="size-4" />
        </Button>
      </div>
      <Separator />

      <button
        onClick={onOpenDashboard}
        className={cn(
          "mx-3 mt-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
          dashboardActive
            ? "bg-accent text-accent-foreground"
            : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
        )}
      >
        <LayoutDashboard className="size-4" />
        Dashboard
      </button>

      <div className="mx-4 mt-5 mb-1 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Projetos
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onNewWorkspace}
          title="Novo workspace"
        >
          <Plus className="size-3" />
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-2">
        <ul className="flex flex-col gap-0.5">
          {workspaces.map((ws) => {
            const active = workspaceFilter === ws.id;
            return (
              <li key={ws.id} className="group relative flex items-center">
                <button
                  onClick={() => onSelectWorkspace(ws.id)}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors min-w-0",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-accent/50",
                  )}
                >
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: wsColorVar(ws.color) }}
                  />
                  <span className="truncate font-mono text-xs">{ws.name}</span>
                </button>
                <div className="absolute right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        title="Mais"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onEditWorkspace(ws)}>
                        <Pencil className="size-3.5" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onArchiveWorkspace(ws)}>
                        <Archive className="size-3.5" />
                        Arquivar
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            );
          })}
          {workspaces.length === 0 && (
            <li className="px-2 py-1 text-[10px] text-muted-foreground">
              Nenhum workspace.
            </li>
          )}
        </ul>
      </div>

      <Separator />
      <div className="p-2">
        <Button
          variant={settingsActive ? "secondary" : "ghost"}
          size="sm"
          className="w-full justify-start"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
          Configurações
        </Button>
      </div>
    </aside>
  );
}
