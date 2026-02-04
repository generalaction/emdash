import { useEffect, useRef, useState } from 'react';

type Item = { path: string; type: 'file' | 'dir' };

export function useFileIndex(rootPath: string | undefined) {
  const [items, setItems] = useState<Item[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadRequestedRef = useRef(false);

  useEffect(() => {
    if (!rootPath) return;
    // Only load once per rootPath (lazy); can be reloaded manually
    if (loadedFor === rootPath || loadRequestedRef.current) return;
    loadRequestedRef.current = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await window.electronAPI.fsList(rootPath, {
          includeDirs: true,
          maxEntries: 5000,
        });
        if (res.canceled) {
          return;
        }
        if (res.success && res.items) {
          setItems(res.items);
          setLoadedFor(rootPath);
        } else {
          setError(res.error || 'Failed to load files');
        }
      } catch (e) {
        setError('Failed to load files');
      } finally {
        setLoading(false);
      }
    })();
  }, [rootPath, loadedFor]);

  const reload = async () => {
    if (!rootPath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.fsList(rootPath, {
        includeDirs: true,
        maxEntries: 5000,
      });
      if (res.canceled) {
        return;
      }
      if (res.success && res.items) {
        setItems(res.items);
        setLoadedFor(rootPath);
      } else {
        setError(res.error || 'Failed to load files');
      }
    } catch (e) {
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  };

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
