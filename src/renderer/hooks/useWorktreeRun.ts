import { useEffect, useState } from 'react';

export interface WorktreeRunState {
  status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
  config: any | null;
  previewUrl: string | null;
  error: string | null;
  logs: string[];
}

export function useWorktreeRun(workspaceId: string | null) {
  const [state, setState] = useState<WorktreeRunState>({
    status: 'idle',
    config: null,
    previewUrl: null,
    error: null,
    logs: [],
  });

  useEffect(() => {
    if (!workspaceId) return;

    // Load initial state
    window.electronAPI.worktreeRunGetState({ workspaceId }).then((result) => {
      if (result.ok && result.state) {
        setState((prev) => ({
          ...prev,
          status: result.state!.status,
          config: result.state!.config,
          previewUrl: result.state!.previewUrl,
          error: result.state!.error,
        }));
      }
    });

    // Subscribe to events
    const unsubscribe = window.electronAPI.onWorktreeRunEvent((event) => {
      if (event.workspaceId !== workspaceId) return;

      if (event.type === 'status' && event.status) {
        setState((prev) => ({
           ...prev,
           status: event.status as WorktreeRunState['status'],
         }));
      } else if (event.type === 'url' && event.url) {
        setState((prev) => ({ ...prev, previewUrl: event.url! }));
      } else if (event.type === 'log' && event.line) {
        setState((prev) => ({
          ...prev,
          logs: [...prev.logs, event.line!],
        }));
      } else if (event.type === 'error' && event.error) {
        setState((prev) => ({ ...prev, error: event.error!, status: 'error' }));
      }
    });

    return unsubscribe;
  }, [workspaceId]);

  const start = async (args: {
    worktreePath: string;
    projectPath: string;
    scriptName?: string;
  }) => {
    if (!workspaceId) return { ok: false, error: 'No workspace selected' };

    setState((prev) => ({ ...prev, logs: [], error: null }));

    return window.electronAPI.worktreeRunStart({
      workspaceId,
      ...args,
    });
  };

  const stop = async () => {
    if (!workspaceId) return { ok: false };
    return window.electronAPI.worktreeRunStop({ workspaceId });
  };

  return {
    state,
    start,
    stop,
  };
}
