import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { pickDirectory } from "@/lib/pickers";
import { store } from "@/lib/runtime";
import {
  WORKSPACE_COLORS,
  type Cli,
  type Workspace,
  type WorkspaceColor,
} from "@/lib/tauri";
import { wsColorVar } from "@/lib/workspaceColors";
import { Check, FolderOpen } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace?: Workspace | null;
  onCreated?: (ws: Workspace) => void;
}

const NONE = "__none__";

export function WorkspaceDialog({
  open,
  onOpenChange,
  workspace,
  onCreated,
}: Props) {
  const isEdit = !!workspace;

  const [name, setName] = useState("");
  const [rootCwd, setRootCwd] = useState("");
  const [defaultCli, setDefaultCli] = useState<string>(NONE);
  const [color, setColor] = useState<WorkspaceColor>("lime");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName(workspace?.name ?? "");
      setRootCwd(workspace?.rootCwd ?? "");
      setDefaultCli(workspace?.defaultCli ?? NONE);
      setColor((workspace?.color as WorkspaceColor) ?? "lime");
      setError(null);
    }
  }, [open, workspace]);

  const pick = async () => {
    const picked = await pickDirectory({
      defaultPath: rootCwd || undefined,
      title: "Diretório raiz do workspace",
    });
    if (picked) {
      setRootCwd(picked);
      if (!name) {
        const base = picked.split("/").filter(Boolean).pop();
        if (base) setName(base);
      }
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const cli = defaultCli === NONE ? null : (defaultCli as Cli);
      if (isEdit && workspace) {
        await store.workspaceUpdate(workspace.id, {
          name: name.trim(),
          rootCwd,
          defaultCli: cli,
          color,
        });
      } else {
        const created = await store.workspaceCreate({
          name: name.trim(),
          rootCwd,
          defaultCli: cli,
          color,
        });
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>
              {isEdit ? "Editar workspace" : "Novo workspace"}
            </DialogTitle>
            <DialogDescription>
              Agrupa sessões de um mesmo projeto com diretório raiz e CLI
              padrão.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-name">Nome</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="agtx"
              required
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-cwd">Diretório raiz</Label>
            <div className="flex gap-2">
              <Input
                id="ws-cwd"
                value={rootCwd}
                readOnly
                className="font-mono"
                placeholder="/home/luan/Projects/..."
                required
              />
              <Button type="button" variant="outline" onClick={pick}>
                <FolderOpen className="size-4" />
                Escolher
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ws-cli">CLI padrão</Label>
            <Select value={defaultCli} onValueChange={setDefaultCli}>
              <SelectTrigger id="ws-cli">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— nenhuma —</SelectItem>
                <SelectItem value="claude">Claude Code</SelectItem>
                <SelectItem value="codex">Codex (OpenAI)</SelectItem>
                <SelectItem value="opencode">OpenCode</SelectItem>
                <SelectItem value="shell">Shell</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {WORKSPACE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setColor(c)}
                  title={c}
                  className={cn(
                    "flex size-7 items-center justify-center rounded-full border-2 transition-all",
                    color === c
                      ? "border-foreground"
                      : "border-transparent hover:border-muted-foreground/40",
                  )}
                  style={{ backgroundColor: wsColorVar(c) }}
                >
                  {color === c && (
                    <Check className="size-3.5 text-background" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <p className="text-xs text-[var(--status-error)]">{error}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!name.trim() || !rootCwd || busy}>
              {isEdit ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
