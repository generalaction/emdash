import { useEffect, useState } from 'react';
import { activityStore } from '../lib/activityStore';

/**
 * Returns the timestamp (ms) when the task last transitioned from busy → idle,
 * or null if the task is currently running or was never active this session.
 * Forces a re-render every 30s so relative time display stays current.
 */
export function useTaskIdleSince(taskId: string, isRunning: boolean): number | null {
  const [, setTick] = useState(0);

  const idleSince = isRunning ? null : activityStore.getIdleSince(taskId);

  useEffect(() => {
    if (isRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [isRunning]);

  return idleSince;
}
