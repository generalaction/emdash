import { useEffect, useState } from 'react';

export type DiffLine = { left?: string; right?: string; type: 'context' | 'add' | 'del' };

export function useFileDiff(
  taskPath: string | undefined,
  filePath: string | undefined,
  refreshKey: number = 0
) {
  const [lines, setLines] = useState<DiffLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!taskPath || !filePath) return;
      setLoading(true);
      setError(null);
      try {
        const res = await window.electronAPI.getFileDiff({ taskPath, filePath });
        if (!cancelled) {
          if (res?.success && res.diff) setLines(res.diff.lines);
          else setError(res?.error || 'Failed to load diff');
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load diff');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [taskPath, filePath, refreshKey]);

  return { lines, loading, error };
}
