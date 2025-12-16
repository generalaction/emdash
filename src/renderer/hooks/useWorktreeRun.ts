import { useEffect, useState } from 'react';
import { getWorkspaceProviderPreference } from '../utils/providerPreference';

// Type helper to access worktreeRun methods
type WorktreeRunAPI = {
  worktreeRunGetState: (args: { workspaceId: string }) => Promise<{
    ok: boolean;
    state: {
      workspaceId: string;
      status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
      config: any | null;
      previewUrl: string | null;
      error: string | null;
    } | null;
  }>;
  onWorktreeRunEvent: (
    listener: (event: {
      type: 'status' | 'url' | 'log' | 'error';
      workspaceId: string;
      status?: string;
      url?: string;
      line?: string;
      error?: string;
    }) => void
  ) => () => void;
  worktreeRunStart: (args: {
    workspaceId: string;
    worktreePath: string;
    projectPath: string;
    scriptName?: string;
    preferredProvider?: string | undefined;
  }) => Promise<{ ok: boolean; error?: string }>;
  worktreeRunStop: (args: { workspaceId: string }) => Promise<{ ok: boolean }>;
};

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
    (window.electronAPI as WorktreeRunAPI & typeof window.electronAPI).worktreeRunGetState({ workspaceId }).then((result: {
      ok: boolean;
      state: {
        workspaceId: string;
        status: 'idle' | 'starting' | 'running' | 'stopped' | 'error';
        config: any | null;
        previewUrl: string | null;
        error: string | null;
      } | null;
    }) => {
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
    const unsubscribe = (window.electronAPI as WorktreeRunAPI & typeof window.electronAPI).onWorktreeRunEvent((event: {
      type: 'status' | 'url' | 'log' | 'error';
      workspaceId: string;
      status?: string;
      url?: string;
      line?: string;
      error?: string;
    }) => {
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

    // Get preferred provider from workspace preference
    const preferredProvider = getWorkspaceProviderPreference(workspaceId);

    setState((prev) => ({ ...prev, logs: [], error: null }));

    return (window.electronAPI as WorktreeRunAPI & typeof window.electronAPI).worktreeRunStart({
      workspaceId,
      ...args,
      preferredProvider,
    });
  };

  const stop = async () => {
    if (!workspaceId) return { ok: false };
    return (window.electronAPI as WorktreeRunAPI & typeof window.electronAPI).worktreeRunStop({ workspaceId });
  };

  return {
    state,
    start,
    stop,
  };
}
