import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { Session, SessionMetrics } from "@/lib/tauri";
import {
  ArrowDown,
  ArrowUp,
  Clock,
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

function fmtUptime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
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

function contextLimitForModel(model: string | null | undefined): number {
  if (!model) return 200_000;
  const lower = model.toLowerCase();
  if (lower.includes("1m")) return 1_000_000;
  if (lower.includes("haiku")) return 200_000;
  return 200_000;
}

interface Props {
  session: Session;
}

export function SessionInfoBar({ session }: Props) {
  const metrics = session.metrics;
  const model = metrics?.model ?? session.model;

  // Tick para atualizar uptime sem recriar o componente inteiro.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, []);

  const uptime = fmtUptime(Date.now() - session.createdAt);
  const limit = contextLimitForModel(model);
  const context = metrics?.contextTokens ?? 0;
  const contextPct = Math.min(100, (context / limit) * 100);

  return (
    <div className="flex items-center gap-4 border-b bg-card/20 px-4 py-1.5 text-[11px] font-mono text-muted-foreground">
      <MetricChip icon={<Sparkles className="size-3" />} label={prettyModel(model)} />
      <MetricChip icon={<Clock className="size-3" />} label={uptime} />
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
