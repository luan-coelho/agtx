import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { api, type ClaudeSessionSummary } from "@/lib/tauri";
import { History, Sparkles } from "lucide-react";

function fmtRelative(ts: number): string {
  const delta = Date.now() - ts;
  const s = Math.floor(delta / 1000);
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

interface Props {
  cwd: string;
  currentId: string | null;
  onResume: (id: string) => void;
  onFresh: () => void;
  /** Quando não-null, destaca esta sessão com tag "esta". */
  ownId?: string | null;
}

export function ClaudeResumePicker({
  cwd,
  currentId,
  onResume,
  onFresh,
  ownId,
}: Props) {
  const [items, setItems] = useState<ClaudeSessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .claudeSessionsForCwd(cwd)
      .then((list) => {
        if (alive) setItems(list);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [cwd]);

  if (items === null && !error) {
    return (
      <div className="text-xs text-muted-foreground">Carregando sessões…</div>
    );
  }
  if (error) {
    return (
      <div className="text-xs text-[var(--status-error)]">{error}</div>
    );
  }
  const list = items ?? [];

  return (
    <div className="flex w-full max-w-lg flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {list.length === 0
            ? "Nenhuma conversa anterior neste diretório."
            : `${list.length} conversa${list.length === 1 ? "" : "s"} disponíve${list.length === 1 ? "l" : "is"}`}
        </span>
        <Button size="sm" variant="outline" onClick={onFresh}>
          <Sparkles className="size-4" />
          Nova conversa
        </Button>
      </div>

      {list.length > 0 && (
        <ScrollArea className="max-h-60 rounded-md border">
          <ul className="flex flex-col divide-y divide-border/50">
            {list.map((item) => {
              const isCurrent = item.id === currentId;
              const isOwn = ownId && item.id === ownId;
              return (
                <li key={item.id}>
                  <button
                    onClick={() => onResume(item.id)}
                    className={cn(
                      "flex w-full flex-col gap-1 px-3 py-2 text-left text-xs transition-colors hover:bg-accent/50",
                      isCurrent && "bg-accent/40",
                    )}
                  >
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <History className="size-3" />
                      <span className="font-mono">{item.id.slice(0, 8)}</span>
                      <span>·</span>
                      <span>{fmtRelative(item.modifiedAtMs)}</span>
                      <span>·</span>
                      <span>{item.lineCount} msgs</span>
                      {isOwn && (
                        <span className="ml-auto rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
                          esta
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        "truncate text-foreground/80",
                        !(item.title ?? item.firstUserPrompt) &&
                          "italic text-muted-foreground",
                      )}
                    >
                      {item.title ?? item.firstUserPrompt ?? "(sem preview)"}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
