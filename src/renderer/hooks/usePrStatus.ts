import { useEffect, useState } from 'react';
import { subscribeToPrStatus, refreshPrStatus } from '../lib/prStatusStore';
import type { PrInfo } from '../lib/prStatus';

export type PrStatus = PrInfo & {
  mergeStateStatus?: string;
  headRefName?: string;
  baseRefName?: string;
  additions?: number;
  deletions?: number;
  changedFiles?: number;
};

export function usePrStatus(taskPath?: string) {
  const [pr, setPr] = useState<PrStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!taskPath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await refreshPrStatus(taskPath);
      setPr(result);
      setError(null);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!taskPath) {
      setPr(null);
      return;
    }

    return subscribeToPrStatus(taskPath, setPr);
  }, [taskPath]);

  return { pr, loading, error, refresh };
}
