import { createContext, ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { rpc } from '@renderer/core/ipc';

const MIN_DISPLAY_MS = 1000;
const POLL_INTERVAL_MS = 1000;

const log = (msg: string, data?: Record<string, unknown>) => {
  console.log(`[ProjectBootstrap] ${msg}`, data ?? '');
};

export type ProjectBootstrapEntry = {
  startedAt: number;
  status: 'bootstrapping' | 'ready' | 'error';
  error?: string;
};

interface ProjectBootstrapContextValue {
  entries: Record<string, ProjectBootstrapEntry>;
  startTracking: (projectId: string) => void;
}

const ProjectBootstrapContext = createContext<ProjectBootstrapContextValue | null>(null);

export function ProjectBootstrapProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, ProjectBootstrapEntry>>({});
  const intervalsRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  const stopPolling = useCallback((projectId: string) => {
    const interval = intervalsRef.current.get(projectId);
    if (interval !== undefined) {
      clearInterval(interval);
      intervalsRef.current.delete(projectId);
    }
  }, []);

  const resolveEntry = useCallback(
    (projectId: string, status: 'ready' | 'error', error?: string) => {
      log(`resolveEntry: ${status}`, { projectId, error });
      stopPolling(projectId);
      setEntries((prev) => ({
        ...prev,
        [projectId]: { ...prev[projectId]!, status, error },
      }));
    },
    [stopPolling]
  );

  const startPolling = useCallback(
    (projectId: string, startedAt: number) => {
      if (intervalsRef.current.has(projectId)) return;

      const interval = setInterval(async () => {
        try {
          const result = await rpc.projects.getProjectBootstrapStatus(projectId);
          const elapsed = Date.now() - startedAt;
          log(`poll result: ${result.status}`, { projectId, elapsed });
          if (result.status === 'ready') {
            if (elapsed >= MIN_DISPLAY_MS) {
              resolveEntry(projectId, 'ready');
            } else {
              log(`ready but min display not met, waiting`, {
                projectId,
                elapsed,
                remaining: MIN_DISPLAY_MS - elapsed,
              });
            }
          } else if (result.status === 'error') {
            resolveEntry(projectId, 'error', result.message);
          }
          // 'bootstrapping' and 'not-started': continue polling
        } catch (e) {
          log(`poll RPC error (will retry)`, { projectId, error: String(e) });
        }
      }, POLL_INTERVAL_MS);

      intervalsRef.current.set(projectId, interval);
    },
    [resolveEntry]
  );

  const startTracking = useCallback(
    async (projectId: string) => {
      const existing = entries[projectId];
      if (existing?.status === 'ready' || existing?.status === 'error') {
        log(`startTracking: already resolved (${existing.status}), skipping`, { projectId });
        return;
      }
      if (intervalsRef.current.has(projectId)) {
        log(`startTracking: already polling, skipping`, { projectId });
        return;
      }

      log(`startTracking: checking initial status`, { projectId });

      try {
        const result = await rpc.projects.getProjectBootstrapStatus(projectId);
        log(`startTracking: initial status = ${result.status}`, { projectId });

        if (result.status === 'ready') {
          log(`startTracking: already ready, no loading state`, { projectId });
          return;
        }

        const startedAt = Date.now();

        if (result.status === 'error') {
          log(`startTracking: initial status is error`, { projectId, error: result.message });
          setEntries((prev) => ({
            ...prev,
            [projectId]: { startedAt, status: 'error', error: result.message },
          }));
          return;
        }

        setEntries((prev) => ({
          ...prev,
          [projectId]: { startedAt, status: 'bootstrapping' },
        }));

        if (result.status === 'not-started') {
          log(`startTracking: not-started, triggering openProject`, { projectId });
          rpc.projects.openProject(projectId).catch((e) => {
            log(`startTracking: openProject RPC error`, { projectId, error: String(e) });
          });
        }

        log(`startTracking: starting poll loop`, { projectId });
        startPolling(projectId, startedAt);
      } catch (e) {
        log(`startTracking: initial RPC error`, { projectId, error: String(e) });
      }
    },
    [entries, startPolling]
  );

  return (
    <ProjectBootstrapContext.Provider value={{ entries, startTracking }}>
      {children}
    </ProjectBootstrapContext.Provider>
  );
}

export function useProjectBootstrapContext(): ProjectBootstrapContextValue {
  const context = useContext(ProjectBootstrapContext);
  if (!context) {
    throw new Error('useProjectBootstrapContext must be used within a ProjectBootstrapProvider');
  }
  return context;
}
