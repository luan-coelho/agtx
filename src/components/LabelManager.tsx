import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { wsColorVar } from "@/lib/workspaceColors";
import { api, WORKSPACE_COLORS, type Label } from "@/lib/tauri";
import { useLabels } from "@/hooks/useLabels";
import { Check, Plus, Trash2 } from "lucide-react";

export function LabelManager() {
  const { labels, refresh } = useLabels();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>("lime");
  const [error, setError] = useState<string | null>(null);

  const submitNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setError(null);
    try {
      await api.labelCreate({ name: newName.trim(), color: newColor });
      setNewName("");
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          Labels
          <span className="text-[10px] font-mono text-muted-foreground">
            {labels.length}
          </span>
        </div>
        {!creating && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-3.5" />
            Adicionar
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Labels disponíveis para classificar tarefas no Task Board. Remover um
        label limpa a marcação de qualquer tarefa que o usava.
      </p>

      {creating && (
        <form
          onSubmit={submitNew}
          className="flex flex-col gap-2 rounded-md border bg-card/30 p-3"
        >
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder="Nome do label"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <ColorSwatchPicker value={newColor} onChange={setNewColor} />
          </div>
          {error && (
            <p className="text-xs text-[var(--status-error)]">{error}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setError(null);
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={!newName.trim()}>
              Criar
            </Button>
          </div>
        </form>
      )}

      <ul className="flex flex-col divide-y divide-border/50 rounded-md border bg-card/30">
        {labels.length === 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">
            Nenhum label ainda.
          </li>
        )}
        {labels.map((l) => (
          <LabelRow key={l.id} label={l} onChanged={refresh} />
        ))}
      </ul>
    </div>
  );
}

function LabelRow({
  label,
  onChanged,
}: {
  label: Label;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState(label.color);

  const save = async () => {
    if (name.trim() === label.name && color === label.color) {
      setEditing(false);
      return;
    }
    try {
      await api.labelUpdate(label.id, {
        name: name.trim() !== label.name ? name.trim() : undefined,
        color: color !== label.color ? color : undefined,
      });
      setEditing(false);
      onChanged();
    } catch {}
  };

  const remove = async () => {
    if (!confirm(`Remover label "${label.name}"? Tarefas com essa marcação ficarão sem label.`))
      return;
    try {
      await api.labelDelete(label.id);
      onChanged();
    } catch {}
  };

  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <span
        className="size-3 rounded-full shrink-0"
        style={{ backgroundColor: wsColorVar(label.color) }}
      />
      {editing ? (
        <>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-7 flex-1"
          />
          <ColorSwatchPicker value={color} onChange={setColor} />
          <Button size="sm" onClick={save}>
            <Check className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
              setName(label.name);
              setColor(label.color);
            }}
          >
            Cancelar
          </Button>
        </>
      ) : (
        <>
          <button
            onClick={() => setEditing(true)}
            className="flex-1 min-w-0 text-left text-sm text-foreground/90 hover:text-foreground truncate"
          >
            {label.name}
          </button>
          <span className="text-[10px] font-mono text-muted-foreground">
            {label.id}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={remove}
            title="Remover"
          >
            <Trash2 className="size-3" />
          </Button>
        </>
      )}
    </li>
  );
}

function ColorSwatchPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {WORKSPACE_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            "size-5 rounded-full border-2 transition-all",
            value === c
              ? "border-foreground"
              : "border-transparent hover:border-muted-foreground/40",
          )}
          style={{ backgroundColor: wsColorVar(c) }}
          title={c}
        />
      ))}
    </div>
  );
}
