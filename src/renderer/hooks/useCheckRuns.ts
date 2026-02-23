import { useEffect, useState } from 'react';
import { subscribeToCheckRuns, refreshCheckRuns } from '../lib/checkRunsStore';
import type { CheckRunsStatus } from '../lib/checkRunStatus';

const noopRefresh = async () => {};

export function useCheckRuns(taskPath?: string, enabled = true) {
  const [status, setStatus] = useState<CheckRunsStatus | null>(null);
  const [isLoading, setIsLoading] = useState(!!taskPath && enabled);

  const refresh = async () => {
    if (!taskPath || !enabled) return;
    setIsLoading(true);
    try {
      const result = await refreshCheckRuns(taskPath);
      setStatus(result);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!enabled || !taskPath) {
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
  }, [taskPath, enabled]);

  if (!enabled) {
    return { status: null, refresh: noopRefresh, isLoading: false };
  }

  return { status, refresh, isLoading };
}
