import { useEffect, useState } from 'react';
import { subscribeToCheckRuns, refreshCheckRuns } from '../lib/checkRunsStore';
import type { CheckRunsStatus } from '../lib/checkRunStatus';

export function useCheckRuns(taskPath?: string) {
  const [status, setStatus] = useState<CheckRunsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(!!taskPath);

  const refresh = async () => {
    if (!taskPath) return;
    setIsLoading(true);
    try {
      const result = await refreshCheckRuns(taskPath);
      setStatus(result);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!taskPath) {
      setStatus(null);
      setIsLoading(false);
      return;
    }

    setStatus(null);
    setIsLoading(true);
    return subscribeToCheckRuns(taskPath, (newStatus) => {
      setStatus(newStatus);
      setIsLoading(false);
    });
  }, [taskPath]);

  return { status, refresh, isLoading };
}
