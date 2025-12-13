import { useEffect, useState } from 'react';

export type PrStatus = {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED' | string;
  isDraft?: boolean;
  mergeStateStatus?: string;
  headRefName?: string;
  baseRefName?: string;
  title?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
};

export function usePrStatus(workspacePath?: string) {
  const [pr, setPr] = useState<PrStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const res = await window.electronAPI.getPrStatus({ workspacePath });
      if (res?.success) {
        setPr((res.pr as any) || null);
      } else {
        setError(res?.error || 'Failed to load PR status');
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePath]);

  return { pr, loading, error, refresh };
}
