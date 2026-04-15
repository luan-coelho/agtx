import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { api, type Session, type SessionMetrics } from "@/lib/tauri";
import {
  ArrowDown,
  ArrowUp,
  Cpu,
  Database,
  MessageSquare,
  Sparkles,
} from "lucide-react";

function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

function prettyModel(model: string | null | undefined): string {
  if (!model) return "—";
  // "claude-opus-4-6[1m]" → "Opus 4.6 1M"
  // "claude-sonnet-4-6" → "Sonnet 4.6"
  const m = model
    .replace(/^claude-/, "")
    .replace(/\[1m\]/, " 1M")
    .replace(/-(\d)-(\d)/, " $1.$2")
    .replace(/^(\w)/, (c) => c.toUpperCase());
  return m;
}

function contextLimitForModel(
  model: string | null | undefined,
  observed: number = 0,
): number {
  if (observed > 200_000) return 1_000_000;
  if (!model) return 200_000;
  const lower = model.toLowerCase();
  if (lower.includes("1m")) return 1_000_000;
  if (lower.includes("haiku")) return 200_000;
  // Claude Code ativa 1M por padrão nos modelos 4.6 (opus/sonnet).
  if (lower.includes("opus-4-6") || lower.includes("sonnet-4-6"))
    return 1_000_000;
  return 200_000;
}

interface Props {
  session: Session;
}

export function SessionInfoBar({ session }: Props) {
  const metrics = session.metrics;
  const model = metrics?.model ?? session.model;

  // Polling do transcript para capturar trocas de modelo (/model, Ctrl+P) e
  // atualizações de tokens sem depender de hook event. 3s é suficiente para
  // perceber mudanças sem consumir CPU.
  const transcriptPath = session.transcriptPath;
  useEffect(() => {
    if (!transcriptPath) return;
    const id = window.setInterval(() => {
      void api.transcriptRefresh(session.id, transcriptPath).catch(() => {});
    }, 3000);
    return () => window.clearInterval(id);
  }, [session.id, transcriptPath]);

  const context = metrics?.contextTokens ?? 0;
  const limit = contextLimitForModel(model, context);
  const contextPct = Math.min(100, (context / limit) * 100);

  return (
    <div className="flex items-center gap-4 border-b bg-card/20 px-4 py-1.5 text-[11px] font-mono text-muted-foreground">
      <MetricChip icon={<Sparkles className="size-3" />} label={prettyModel(model)} />
      <ContextGauge used={context} limit={limit} pct={contextPct} />
      {metrics && (
        <>
          <MetricChip
            icon={<ArrowDown className="size-3" />}
            label={fmtTokens(metrics.totalInputTokens + metrics.totalCacheReadTokens + metrics.totalCacheCreationTokens)}
            title={`in: ${metrics.totalInputTokens.toLocaleString()} · cache read: ${metrics.totalCacheReadTokens.toLocaleString()} · cache write: ${metrics.totalCacheCreationTokens.toLocaleString()}`}
          />
          <MetricChip
            icon={<ArrowUp className="size-3" />}
            label={fmtTokens(metrics.totalOutputTokens)}
            title={`out: ${metrics.totalOutputTokens.toLocaleString()}`}
          />
          {metrics.totalCacheReadTokens > 0 && (
            <MetricChip
              icon={<Database className="size-3" />}
              label={`${cacheHitPct(metrics)}%`}
              title="Taxa de acerto do cache (cache_read / input total)"
            />
          )}
          <MetricChip
            icon={<MessageSquare className="size-3" />}
            label={String(metrics.messageCount)}
            title="Mensagens no transcript"
          />
        </>
      )}
      {!metrics && model && (
        <span className="text-muted-foreground/70 italic">
          aguardando primeira interação para medir contexto…
        </span>
      )}
    </div>
  );
}

function MetricChip({
  icon,
  label,
  title,
}: {
  icon: React.ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1"
      title={title}
    >
      <span className="text-foreground/60">{icon}</span>
      <span className="text-foreground/80">{label}</span>
    </span>
  );
}

function ContextGauge({
  used,
  limit,
  pct,
}: {
  used: number;
  limit: number;
  pct: number;
}) {
  const color =
    pct > 85
      ? "var(--status-error)"
      : pct > 65
      ? "var(--status-attention)"
      : "var(--status-done)";
  return (
    <span
      className="inline-flex items-center gap-2"
      title={`Contexto: ${used.toLocaleString()} / ${limit.toLocaleString()} tokens`}
    >
      <Cpu className="size-3 text-foreground/60" />
      <span className="text-foreground/80">
        {fmtTokens(used)} / {fmtTokens(limit)}
      </span>
      <span className="inline-block h-1 w-16 overflow-hidden rounded-full bg-border/60">
        <span
          className={cn("block h-full rounded-full transition-all")}
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
    </span>
  );
}

function cacheHitPct(m: SessionMetrics): number {
  const total =
    m.totalInputTokens + m.totalCacheReadTokens + m.totalCacheCreationTokens;
  if (total === 0) return 0;
  return Math.round((m.totalCacheReadTokens / total) * 100);
}
