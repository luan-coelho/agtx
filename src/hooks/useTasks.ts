import { useEffect, useState, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  api,
  type ClaudeSessionSummary,
  type Task,
  type Workspace,
} from "@/lib/tauri";

export interface TaskView {
  task: Task;
  /** Resumo da conversa no disco (quando existe). */
  summary: ClaudeSessionSummary | null;
  /** Título resolvido final. */
  title: string;
}

/**
 * Combina tasks persistidas + conversas no disco.
 * - Para cada workspace visível, busca `claude_sessions_for_cwd` e garante
 *   via `task_ensure` que toda conversa tem um registro em tasks.
 * - Re-busca ao receber hook-received (novos eventos podem ter promovido/criado tasks).
 */
export function useTasks(
  workspaces: Workspace[],
  workspaceFilter: string | null,
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [conversations, setConversations] = useState<
    Map<string, ClaudeSessionSummary>
  >(new Map());
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      // 1. Pega conversas do disco para cada workspace relevante.
      const relevantWs = workspaceFilter
        ? workspaces.filter((w) => w.id === workspaceFilter)
        : workspaces;

      const convMap = new Map<string, ClaudeSessionSummary>();
      await Promise.all(
        relevantWs.map(async (ws) => {
          try {
            const list = await api.claudeSessionsForCwd(ws.rootCwd);
            for (const c of list) {
              convMap.set(c.id, c);
              // Garante que há task para essa conversa.
              try {
                await api.taskEnsure(ws.id, c.id, "backlog");
              } catch {
                // ignore
              }
            }
          } catch {
            // ignore workspace errors
          }
        }),
      );
      setConversations(convMap);

      // 2. Lista tasks (já com task_ensure garantido acima).
      const list = await api.taskList(workspaceFilter);
      setTasks(list);
    } finally {
      setLoading(false);
    }
  }, [workspaces, workspaceFilter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Atualiza quando hooks chegam.
  useEffect(() => {
    let un: UnlistenFn | undefined;
    listen("hook-received", () => {
      void refresh();
    }).then((u) => {
      un = u;
    });
    return () => {
      un?.();
    };
  }, [refresh]);

  // Monta views combinadas.
  const views: TaskView[] = tasks.map((task) => {
    const summary = conversations.get(task.claudeSessionId) ?? null;
    const title =
      task.titleOverride ??
      summary?.title ??
      summary?.firstUserPrompt ??
      `conversa ${task.claudeSessionId.slice(0, 8)}`;
    return { task, summary, title };
  });

  return { views, loading, refresh };
}
