export type SessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "waiting-input"
  | "needs-attention"
  | "done"
  | "error"
  | "dead";

export const STATUS_META: Record<
  SessionStatus,
  { label: string; color: string; dotClass: string; chipClass: string }
> = {
  starting: {
    label: "Iniciando",
    color: "var(--status-idle)",
    dotClass: "bg-[var(--status-idle)]",
    chipClass: "text-[var(--status-idle)] border-[var(--status-idle)]/30",
  },
  idle: {
    label: "Ocioso",
    color: "var(--status-idle)",
    dotClass: "bg-[var(--status-idle)]",
    chipClass: "text-[var(--status-idle)] border-[var(--status-idle)]/30",
  },
  running: {
    label: "Rodando",
    color: "var(--status-running)",
    dotClass: "bg-[var(--status-running)] animate-pulse",
    chipClass:
      "text-[var(--status-running)] border-[var(--status-running)]/30",
  },
  "waiting-input": {
    label: "Aguardando input",
    color: "var(--status-waiting)",
    dotClass: "bg-[var(--status-waiting)]",
    chipClass:
      "text-[var(--status-waiting)] border-[var(--status-waiting)]/30",
  },
  "needs-attention": {
    label: "Precisa atenção",
    color: "var(--status-attention)",
    dotClass: "bg-[var(--status-attention)] animate-ping-slow",
    chipClass:
      "text-[var(--status-attention)] border-[var(--status-attention)]/40 bg-[var(--status-attention)]/10",
  },
  done: {
    label: "Concluído",
    color: "var(--status-done)",
    dotClass: "bg-[var(--status-done)]",
    chipClass: "text-[var(--status-done)] border-[var(--status-done)]/30",
  },
  error: {
    label: "Erro",
    color: "var(--status-error)",
    dotClass: "bg-[var(--status-error)]",
    chipClass: "text-[var(--status-error)] border-[var(--status-error)]/30",
  },
  dead: {
    label: "Morta",
    color: "var(--muted-foreground)",
    dotClass: "bg-muted-foreground/50",
    chipClass: "text-muted-foreground border-muted-foreground/30",
  },
};

export const STATUS_PRIORITY: SessionStatus[] = [
  "needs-attention",
  "waiting-input",
  "running",
  "starting",
  "idle",
  "done",
  "error",
  "dead",
];
