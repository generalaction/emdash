import { useEffect, useState } from 'react';
import { subscribeToPrStatus, refreshPrStatus } from '../lib/prStatusStore';
import type { PrStatus } from '../lib/prStatus';

export function usePrStatus(taskPath?: string) {
  const [pr, setPr] = useState<PrStatus | null>(null);
  const [prevTaskPath, setPrevTaskPath] = useState(taskPath);

  // Synchronously clear stale pr when taskPath changes (before effects run)
  if (taskPath !== prevTaskPath) {
    setPrevTaskPath(taskPath);
    if (pr !== null) {
      setPr(null);
    }
  }

  const refresh = async () => {
    if (!taskPath) return;
    const result = await refreshPrStatus(taskPath);
    setPr(result);
  };

  useEffect(() => {
    if (!taskPath) {
      setPr(null);
      return;
    }

    return subscribeToPrStatus(taskPath, setPr);
  }, [taskPath]);

  return { pr, refresh };
}
