import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { TaskBoard } from "@/components/TaskBoard";
import { TerminalHeader } from "@/components/Terminal";
import { TerminalHost } from "@/components/TerminalHost";
import { TerminalTabs } from "@/components/TerminalTabs";
import { SessionInfoBar } from "@/components/SessionInfoBar";
import { NewSessionDialog } from "@/components/NewSessionDialog";
import { WorkspaceDialog } from "@/components/WorkspaceDialog";
import { Settings } from "@/components/Settings";
import { useSessions } from "@/hooks/useSessions";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { store } from "@/lib/runtime";
import type { Session, Workspace } from "@/lib/tauri";
import { Terminal as TerminalIcon } from "lucide-react";

type View = "dashboard" | "settings";

function App() {
  const { sessions } = useSessions();
  const { workspaces } = useWorkspaces();

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [workspaceFilter, setWorkspaceFilter] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [newDefaultWs, setNewDefaultWs] = useState<string | null>(null);

  const [wsDialogOpen, setWsDialogOpen] = useState(false);
  const [wsEditing, setWsEditing] = useState<Workspace | null>(null);

  const [leftPct, setLeftPct] = useState(50);
  const splitRef = useRef<HTMLElement | null>(null);
  const draggingRef = useRef(false);

  const onSplitMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    store.setRefitSuspended(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !splitRef.current) return;
      const rect = splitRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      setLeftPct(Math.min(80, Math.max(20, pct)));
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      store.setRefitSuspended(false);
      if (activeTabId) store.refit(activeTabId);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [activeTabId]);

  useEffect(() => {
    void store.bootstrap();
  }, []);

  const sessionById = useMemo(
    () => new Map(sessions.map((s) => [s.id, s] as const)),
    [sessions],
  );

  const active: Session | null = activeTabId
    ? sessionById.get(activeTabId) ?? null
    : null;
  const activeWorkspace = active?.workspaceId
    ? workspaces.find((w) => w.id === active.workspaceId)
    : undefined;

  // Reajusta o xterm quando a tab ativa muda ou quando volta para view dashboard.
  const terminalVisible = view === "dashboard" && !!active;
  useEffect(() => {
    if (!terminalVisible || !activeTabId) return;
    const r1 = requestAnimationFrame(() => {
      const r2 = requestAnimationFrame(() => {
        store.refit(activeTabId);
        store.focus(activeTabId);
      });
      (window as Window & { __agtx_raf2?: number }).__agtx_raf2 = r2;
    });
    return () => {
      cancelAnimationFrame(r1);
      const r2 = (window as Window & { __agtx_raf2?: number }).__agtx_raf2;
      if (r2 !== undefined) cancelAnimationFrame(r2);
    };
  }, [terminalVisible, activeTabId]);

  const openTabFor = (sessionId: string) => {
    setOpenTabs((prev) =>
      prev.includes(sessionId) ? prev : [...prev, sessionId],
    );
    setActiveTabId(sessionId);
    setView("dashboard");
  };

  const closeTab = (sessionId: string) => {
    setOpenTabs((prev) => {
      const idx = prev.indexOf(sessionId);
      const next = prev.filter((id) => id !== sessionId);
      if (activeTabId === sessionId) {
        const fallback = next[idx] ?? next[idx - 1] ?? null;
        setActiveTabId(fallback);
      }
      return next;
    });
  };

  const openNewSession = () => {
    setNewDefaultWs(workspaceFilter);
    setNewOpen(true);
  };

  const openNewWorkspace = () => {
    setWsEditing(null);
    setWsDialogOpen(true);
  };

  const openEditWorkspace = (ws: Workspace) => {
    setWsEditing(ws);
    setWsDialogOpen(true);
  };

  const onArchiveWorkspace = async (ws: Workspace) => {
    if (!confirm(`Arquivar workspace "${ws.name}"?`)) return;
    await store.workspaceArchive(ws.id);
    if (workspaceFilter === ws.id) setWorkspaceFilter(null);
  };

  const openDashboardWithFilter = (wsId: string | null) => {
    setWorkspaceFilter(wsId);
    setView("dashboard");
  };

  // Monta tabs com metadata.
  const tabs = openTabs
    .map((id) => {
      const session = sessionById.get(id);
      if (!session) return null;
      const title =
        session.lastPrompt?.slice(0, 40) ??
        session.claudeSessionId?.slice(0, 8) ??
        session.cli;
      return { sessionId: id, session, title };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen bg-background text-foreground">
        <Sidebar
          workspaces={workspaces}
          workspaceFilter={workspaceFilter}
          onSelectWorkspace={(id) => openDashboardWithFilter(id)}
          onNew={openNewSession}
          onOpenSettings={() => setView("settings")}
          onOpenDashboard={() => openDashboardWithFilter(null)}
          dashboardActive={view === "dashboard" && workspaceFilter === null}
          settingsActive={view === "settings"}
          onNewWorkspace={openNewWorkspace}
          onEditWorkspace={openEditWorkspace}
          onArchiveWorkspace={onArchiveWorkspace}
        />

        {view === "settings" ? (
          <main className="flex flex-1 min-w-0 flex-col">
            <Settings />
          </main>
        ) : (
          <main ref={splitRef} className="flex flex-1 min-w-0">
            {/* Coluna central: Task Board */}
            <div
              className="flex min-w-0 flex-col border-r"
              style={{ width: `${leftPct}%` }}
            >
              <TaskBoard
                workspaces={workspaces}
                workspaceFilter={workspaceFilter}
                onSelectWorkspace={setWorkspaceFilter}
                onOpenSession={openTabFor}
                onNewSession={openNewSession}
                activeSessionId={activeTabId}
              />
            </div>

            {/* Divisor arrastável */}
            <div
              role="separator"
              aria-orientation="vertical"
              onMouseDown={onSplitMouseDown}
              className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/40 transition-colors"
            />

            {/* Coluna direita: terminal com abas */}
            <div
              className="flex min-w-0 flex-col"
              style={{ width: `${100 - leftPct}%` }}
            >
              <TerminalTabs
                tabs={tabs}
                activeId={activeTabId}
                onActivate={setActiveTabId}
                onClose={closeTab}
              />
              {active ? (
                <>
                  <TerminalHeader
                    session={active}
                    workspace={activeWorkspace}
                    onClose={() => closeTab(active.id)}
                    onSelect={(id) => setActiveTabId(id)}
                  />
                  {active.cli === "claude" && (
                    <SessionInfoBar session={active} />
                  )}
                </>
              ) : null}
              <div className="flex-1 min-h-0 relative">
                {!active && <TerminalEmptyState />}
                <TerminalHost
                  sessions={sessions}
                  activeId={activeTabId}
                  onSelect={setActiveTabId}
                />
              </div>
            </div>
          </main>
        )}
      </div>

      <NewSessionDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        workspaces={workspaces}
        defaultWorkspaceId={newDefaultWs}
        onCreate={(opts) => {
          const created = store.create({
            cli: opts.cli,
            cwd: opts.cwd,
            workspaceId: opts.workspaceId,
          });
          openTabFor(created.id);
        }}
      />

      <WorkspaceDialog
        open={wsDialogOpen}
        onOpenChange={setWsDialogOpen}
        workspace={wsEditing}
      />
    </TooltipProvider>
  );
}

function TerminalEmptyState() {
  return (
    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background text-center text-muted-foreground">
      <TerminalIcon className="size-8 opacity-40" />
      <div className="text-sm">Nenhuma sessão aberta</div>
      <div className="text-xs text-muted-foreground/70 max-w-xs">
        Clique numa tarefa à esquerda para abrir uma sessão, ou crie uma nova
        pelo botão <span className="font-mono text-foreground/70">+</span> no
        sidebar.
      </div>
    </div>
  );
}

export default App;
