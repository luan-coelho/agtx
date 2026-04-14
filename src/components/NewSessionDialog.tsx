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
import { FolderOpen } from "lucide-react";
import { pickDirectory } from "@/lib/pickers";
import { wsColorVar } from "@/lib/workspaceColors";
import { useEffect, useState } from "react";
import type { Cli, Workspace } from "@/lib/tauri";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaces: Workspace[];
  defaultWorkspaceId?: string | null;
  onCreate: (opts: {
    cli: Cli;
    cwd: string;
    workspaceId: string | null;
  }) => void;
}

const INBOX = "__inbox__";

export function NewSessionDialog({
  open,
  onOpenChange,
  workspaces,
  defaultWorkspaceId,
  onCreate,
}: Props) {
  const [wsId, setWsId] = useState<string>(INBOX);
  const [cli, setCli] = useState<Cli>("claude");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    if (!open) return;
    const initial = defaultWorkspaceId ?? INBOX;
    setWsId(initial);
    applyDefaults(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultWorkspaceId]);

  const applyDefaults = (id: string) => {
    if (id === INBOX) {
      // Preserva o que o user já tinha, mas se está vazio limpa.
      return;
    }
    const ws = workspaces.find((w) => w.id === id);
    if (!ws) return;
    setCwd(ws.rootCwd);
    if (ws.defaultCli) setCli(ws.defaultCli);
  };

  const onChangeWorkspace = (id: string) => {
    setWsId(id);
    applyDefaults(id);
  };

  const pick = async () => {
    const picked = await pickDirectory({
      defaultPath: cwd || undefined,
      title: "Diretório da sessão",
    });
    if (picked) setCwd(picked);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreate({
      cli,
      cwd,
      workspaceId: wsId === INBOX ? null : wsId,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Nova sessão</DialogTitle>
            <DialogDescription>
              Escolha o workspace (opcional), a CLI e o diretório.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ns-ws">Workspace</Label>
            <Select value={wsId} onValueChange={onChangeWorkspace}>
              <SelectTrigger id="ns-ws">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={INBOX}>Inbox (sem workspace)</SelectItem>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-2 rounded-full"
                        style={{ backgroundColor: wsColorVar(w.color) }}
                      />
                      {w.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cli">CLI</Label>
            <Select value={cli} onValueChange={(v) => setCli(v as Cli)}>
              <SelectTrigger id="cli">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude">Claude Code</SelectItem>
                <SelectItem value="codex">Codex (OpenAI)</SelectItem>
                <SelectItem value="opencode">OpenCode</SelectItem>
                <SelectItem value="shell">Shell</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="cwd">Diretório</Label>
            <div className="flex gap-2">
              <Input
                id="cwd"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/home/luan/Projects/..."
                required
                readOnly
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={pick}
                title="Escolher diretório"
              >
                <FolderOpen className="size-4" />
                Escolher
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={!cwd}>
              Criar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
