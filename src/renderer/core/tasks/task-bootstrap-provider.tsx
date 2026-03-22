import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { rpc } from '@renderer/core/ipc';

const MIN_DISPLAY_MS = 1000;
const POLL_INTERVAL_MS = 1000;

const log = (msg: string, data?: Record<string, unknown>) => {
  console.log(`[TaskBootstrap] ${msg}`, data ?? '');
};

export type BootstrapEntry = {
  startedAt: number;
  status: 'bootstrapping' | 'ready' | 'error';
  error?: string;
};

interface TaskBootstrapContextValue {
  entries: Record<string, BootstrapEntry>;
  startTracking: (projectId: string, taskId: string) => void;
}

const TaskBootstrapContext = createContext<TaskBootstrapContextValue | null>(null);

export function TaskBootstrapProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, BootstrapEntry>>({});
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const stopPolling = useCallback((taskId: string) => {
    const interval = intervalsRef.current.get(taskId);
    if (interval !== undefined) {
      clearInterval(interval);
      intervalsRef.current.delete(taskId);
    }
  }, []);

  const resolveEntry = useCallback(
    (taskId: string, status: 'ready' | 'error', error?: string) => {
      log(`resolveEntry: ${status}`, { taskId, error });
      stopPolling(taskId);
      setEntries((prev) => ({
        ...prev,
        [taskId]: { ...prev[taskId]!, status, error },
      }));
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (projectId: string, taskId: string, startedAt: number) => {
      if (intervalsRef.current.has(taskId)) return;

      const interval = setInterval(async () => {
        try {
          const result = await rpc.tasks.getBootstrapStatus(projectId, taskId);
          const elapsed = Date.now() - startedAt;
          log(`poll result: ${result.status}`, { taskId, elapsed });
          if (result.status === 'ready') {
            if (elapsed >= MIN_DISPLAY_MS) {
              resolveEntry(taskId, 'ready');
            } else {
              log(`ready but min display not met, waiting`, {
                taskId,
                elapsed,
                remaining: MIN_DISPLAY_MS - elapsed,
              });
            }
            // If not enough time has passed, keep polling until the min display
            // time is satisfied — the next tick will re-check elapsed time.
          } else if (result.status === 'error') {
            resolveEntry(taskId, 'error', result.message);
          }
          // 'bootstrapping' and 'not-started': continue polling
        } catch (e) {
          log(`poll RPC error (will retry)`, { taskId, error: String(e) });
        }
      }, POLL_INTERVAL_MS);

      intervalsRef.current.set(taskId, interval);
    },
    [resolveEntry]
  );

  const startTracking = useCallback(
    async (projectId: string, taskId: string) => {
      // Skip if already tracking or resolved
      const existing = entries[taskId];
      if (existing?.status === 'ready' || existing?.status === 'error') {
        log(`startTracking: already resolved (${existing.status}), skipping`, { taskId });
        return;
      }
      if (intervalsRef.current.has(taskId)) {
        log(`startTracking: already polling, skipping`, { taskId });
        return;
      }

      log(`startTracking: checking initial status`, { taskId });

      // Set bootstrapping synchronously before the await so that consumers see a
      // defined entry immediately and don't treat the undefined-entry window as
      // "already ready", which would trigger premature file-tree loads.
      const startedAt = Date.now();
      setEntries((prev) => ({
        ...prev,
        [taskId]: { startedAt, status: 'bootstrapping' },
      }));

      try {
        const result = await rpc.tasks.getBootstrapStatus(projectId, taskId);
        log(`startTracking: initial status = ${result.status}`, { taskId });

        if (result.status === 'ready') {
          // Already bootstrapped — resolve immediately with no visible loading delay.
          log(`startTracking: already ready, resolving immediately`, { taskId });
          resolveEntry(taskId, 'ready');
          return;
        }

        if (result.status === 'not-started') {
          log(`startTracking: not-started, kicking off provision`, { taskId });
          // Kick off provision (idempotent — safe to call even if already in progress)
          rpc.tasks.provisionTask(taskId).catch((e) => {
            log(`startTracking: provisionTask RPC error`, { taskId, error: String(e) });
          });
        }

        if (result.status === 'error') {
          log(`startTracking: initial status is error`, { taskId, error: result.message });
          resolveEntry(taskId, 'error', result.message);
          return;
        }

        log(`startTracking: starting poll loop`, { taskId });
        startPolling(projectId, taskId, startedAt);
      } catch (e) {
        log(`startTracking: initial RPC error`, { taskId, error: String(e) });
      }
    },
    [entries, startPolling]
  );

  return (
    <TaskBootstrapContext.Provider value={{ entries, startTracking }}>
      {children}
    </TaskBootstrapContext.Provider>
  );
}

export function useTaskBootstrapContext(): TaskBootstrapContextValue {
  const context = useContext(TaskBootstrapContext);
  if (!context) {
    throw new Error('useTaskBootstrapContext must be used within a TaskBootstrapProvider');
  }
  return context;
}
