import { useEffect, useState } from 'react';
import { subscribeToPrComments, refreshPrComments } from '../lib/prCommentsStore';
import type { PrCommentsStatus } from '../lib/prCommentsStatus';

export function usePrComments(taskPath?: string, prNumber?: number) {
  const [status, setStatus] = useState<PrCommentsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = async () => {
    if (!taskPath) return;
    setIsLoading(true);
    try {
      const result = await refreshPrComments(taskPath);
      setStatus(result);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!taskPath) {
      setStatus(null);
      return;
    }

    setStatus(null);
    return subscribeToPrComments(taskPath, prNumber, setStatus);
  }, [taskPath, prNumber]);

  return { status, refresh, isLoading };
}
