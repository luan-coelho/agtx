import { useSyncExternalStore } from "react";
import { store } from "@/lib/runtime";

export function useWorkspaces() {
  const workspaces = useSyncExternalStore(
    store.subscribeWorkspaces,
    store.getWorkspacesSnapshot,
    store.getWorkspacesSnapshot,
  );
  return { workspaces };
}
