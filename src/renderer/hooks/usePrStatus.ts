import { useEffect, useState } from 'react';
import { subscribeToPrStatus, refreshPrStatus } from '../lib/prStatusStore';
import type { PrStatus } from '../lib/prStatus';

export function usePrStatus(taskPath?: string) {
  const [pr, setPr] = useState<PrStatus | null>(null);

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

    setPr(null); // Clear stale data before subscribing to new task
    return subscribeToPrStatus(taskPath, setPr);
  }, [taskPath]);

  return { pr, refresh };
}
