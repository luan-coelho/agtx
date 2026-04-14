import { useSyncExternalStore, useMemo } from "react";
import { store } from "@/lib/runtime";
import { STATUS_PRIORITY } from "@/lib/status";

export function useSessions() {
  const sessions = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const sorted = useMemo(() => {
    return [...sessions].sort((a, b) => {
      const pa = STATUS_PRIORITY.indexOf(a.status);
      const pb = STATUS_PRIORITY.indexOf(b.status);
      if (pa !== pb) return pa - pb;
      return b.lastActivityAt - a.lastActivityAt;
    });
  }, [sessions]);

  return { sessions: sorted, loading: false };
}
