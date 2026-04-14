import type { WorkspaceColor } from "./tauri";

export function wsColorVar(color: WorkspaceColor | string | null | undefined): string {
  return `var(--ws-${color ?? "lime"})`;
}

export function wsColorStyle(
  color: WorkspaceColor | string | null | undefined,
): React.CSSProperties {
  return { backgroundColor: wsColorVar(color) };
}
