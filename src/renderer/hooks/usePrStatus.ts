import { useEffect, useState } from 'react';
import { subscribeToPrStatus, refreshPrStatus } from '../lib/prStatusStore';
import type { PrStatus } from '../lib/prStatus';

const noopRefresh = async () => {};

export function usePrStatus(taskPath?: string, enabled = true) {
  const [pr, setPr] = useState<PrStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [prevTaskPath, setPrevTaskPath] = useState(taskPath);

  // Synchronously clear stale pr when taskPath changes (before effects run)
  if (taskPath !== prevTaskPath) {
    setPrevTaskPath(taskPath);
    if (pr !== null) {
      setPr(null);
    }
  }

  const refresh = async () => {
    if (!taskPath || !enabled) return;
    setIsLoading(true);
    const result = await refreshPrStatus(taskPath);
    setPr(result);
    setIsLoading(false);
  };

  useEffect(() => {
    if (!enabled || !taskPath) {
      setPr(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    return subscribeToPrStatus(taskPath, (newPr, newLoading) => {
      setPr(newPr);
      setIsLoading(newLoading);
    });
  }, [taskPath, enabled]);

  if (!enabled) {
    return { pr: null, isLoading: false, refresh: noopRefresh };
  }

  return { pr, isLoading, refresh };
}
