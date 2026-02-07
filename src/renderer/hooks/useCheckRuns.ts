import { useEffect, useState } from 'react';
import { subscribeToCheckRuns, refreshCheckRuns } from '../lib/checkRunsStore';
import type { CheckRunsStatus } from '../lib/checkRunStatus';

export function useCheckRuns(taskPath?: string) {
  const [status, setStatus] = useState<CheckRunsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(false);

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
      return;
    }

    setStatus(null);
    return subscribeToCheckRuns(taskPath, setStatus);
  }, [taskPath]);

  return { status, refresh, isLoading };
}
