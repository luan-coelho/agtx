import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  api,
  type HooksStatus,
  type HttpInfo,
} from "@/lib/tauri";
import { LabelManager } from "./LabelManager";
import {
  Check,
  Copy,
  Plug,
  PlugZap,
  ShieldCheck,
  Tags,
  Terminal as TerminalIcon,
} from "lucide-react";

export function Settings() {
  const [httpInfo, setHttpInfo] = useState<HttpInfo | null>(null);
  const [status, setStatus] = useState<HooksStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [h, s] = await Promise.all([api.httpInfo(), api.hooksStatus()]);
      setHttpInfo(h);
      setStatus(s);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const install = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.hooksInstall();
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await api.hooksUninstall();
      setStatus(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Configurações</h1>
          <p className="text-xs text-muted-foreground">
            Hook receiver e integração com Claude Code.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          <Card className="p-4 gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <TerminalIcon className="size-4 text-muted-foreground" />
              Hook receiver HTTP
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Servidor local em porta efêmera que recebe eventos dos hooks do
              Claude Code. Só aceita requests com o shared secret abaixo no
              header <code className="font-mono">X-Agtx-Secret</code>.
            </p>
            <Separator />
            <KV label="Porta" value={httpInfo ? `127.0.0.1:${httpInfo.port}` : "…"} copyable />
            <KV label="Secret" value={httpInfo?.secret ?? "…"} mono copyable secret />
          </Card>

          <Card className="p-4 gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4 text-muted-foreground" />
                Hooks do Claude Code
              </div>
              <span
                className={
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase " +
                  (status?.installed
                    ? "border-[var(--status-done)]/40 text-[var(--status-done)]"
                    : "border-muted-foreground/30 text-muted-foreground")
                }
              >
                <span
                  className={
                    "size-1.5 rounded-full " +
                    (status?.installed
                      ? "bg-[var(--status-done)]"
                      : "bg-muted-foreground/60")
                  }
                />
                {status?.installed ? "Instalado" : "Não instalado"}
              </span>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Ao instalar, o agtx mescla entradas em{" "}
              <code className="font-mono">
                {status?.settingsPath ?? "~/.claude/settings.json"}
              </code>{" "}
              para os eventos abaixo. Cada entrada é marcada com{" "}
              <code className="font-mono">agtx_managed: true</code> — desinstalar
              remove só essas, preservando seus hooks pessoais. É feito um backup{" "}
              <code className="font-mono">.bak.&lt;timestamp&gt;</code> antes de cada mudança.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {(status?.installedEvents.length
                ? status.installedEvents
                : [
                    "SessionStart",
                    "UserPromptSubmit",
                    "PreToolUse",
                    "PostToolUse",
                    "Notification",
                    "Stop",
                    "SubagentStop",
                    "SessionEnd",
                    "PreCompact",
                  ]
              ).map((ev) => (
                <span
                  key={ev}
                  className={
                    "rounded border px-1.5 py-0.5 text-[10px] font-mono " +
                    (status?.installedEvents.includes(ev)
                      ? "border-[var(--status-done)]/40 text-[var(--status-done)]"
                      : "border-border text-muted-foreground")
                  }
                >
                  {ev}
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 pt-1">
              {status?.installed ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={uninstall}
                  disabled={busy}
                >
                  <Plug className="size-4" /> Desinstalar
                </Button>
              ) : (
                <Button size="sm" onClick={install} disabled={busy}>
                  <PlugZap className="size-4" /> Instalar hooks
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void refresh()}
                disabled={busy}
              >
                Recarregar
              </Button>
              {error && (
                <span className="text-xs text-[var(--status-error)]">
                  {error}
                </span>
              )}
            </div>
          </Card>

          <Card className="p-4 gap-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tags className="size-4 text-muted-foreground" />
              Catálogo de labels
            </div>
            <LabelManager />
          </Card>
        </div>
      </div>
    </div>
  );
}

function KV({
  label,
  value,
  mono,
  copyable,
  secret,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copyable?: boolean;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [reveal, setReveal] = useState(!secret);
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={
            "truncate " + (mono || secret ? "font-mono" : "") + " max-w-[360px]"
          }
        >
          {reveal ? value : "••••••••••••••••"}
        </span>
        {secret && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setReveal((r) => !r)}
            title={reveal ? "Ocultar" : "Mostrar"}
          >
            {reveal ? (
              <span className="text-[10px]">hide</span>
            ) : (
              <span className="text-[10px]">show</span>
            )}
          </Button>
        )}
        {copyable && (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            }}
            title="Copiar"
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
