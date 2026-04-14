import { useCallback, useEffect, useState } from "react";
import { api, type Label } from "@/lib/tauri";

export function useLabels() {
  const [labels, setLabels] = useState<Label[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const list = await api.labelList();
      setLabels(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { labels, loading, refresh };
}
