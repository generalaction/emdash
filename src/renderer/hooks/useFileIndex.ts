import { useCallback, useEffect, useRef, useState } from 'react';

type Item = { path: string; type: 'file' | 'dir' };

export function useFileIndex(rootPath: string | undefined) {
  const [items, setItems] = useState<Item[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRequestedForRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);

  const loadFiles = useCallback(async (pathToLoad: string) => {
    const requestId = ++requestIdRef.current;
    loadRequestedForRef.current = pathToLoad;
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.fsList(pathToLoad, {
        includeDirs: true,
        maxEntries: 5000,
      });
      if (requestId !== requestIdRef.current || loadRequestedForRef.current !== pathToLoad) {
        return;
      }
      if (res.success && res.items) {
        setItems(res.items);
        setLoadedFor(pathToLoad);
      } else {
        setError(res.error || 'Failed to load files');
      }
    } catch (e) {
      if (requestId !== requestIdRef.current || loadRequestedForRef.current !== pathToLoad) {
        return;
      }
      setError('Failed to load files');
    } finally {
      if (requestId !== requestIdRef.current || loadRequestedForRef.current !== pathToLoad) {
        return;
      }
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!rootPath) return;
    // Only load once per rootPath (lazy); can be reloaded manually
    if (loadedFor === rootPath || loadRequestedForRef.current === rootPath) return;
    void loadFiles(rootPath);
  }, [rootPath, loadedFor, loadFiles]);

  const reload = useCallback(async () => {
    if (!rootPath) return;
    await loadFiles(rootPath);
  }, [rootPath, loadFiles]);

  const search = (query: string, limit = 12): Item[] => {
    if (!query) return items.slice(0, limit);
    const q = query.toLowerCase();

    // Basic scoring: startsWith > includes; shorter path wins
    const scored = items
      .map((it) => {
        const p = it.path.toLowerCase();
        let score = Infinity;
        const idx = p.indexOf(q);
        if (idx === 0) score = 0;
        else if (idx > 0) score = 100 + idx;
        else return null;
        // prefer files a bit
        if (it.type === 'file') score -= 1;
        // shorter total path wins
        score += p.length * 0.001;
        return { it, score };
      })
      .filter((x): x is { it: Item; score: number } => x !== null)
      .sort((a, b) => a.score - b.score)
      .slice(0, limit)
      .map((s) => s.it);

    return scored;
  };

  return { items, loading, error, search, reload };
}
