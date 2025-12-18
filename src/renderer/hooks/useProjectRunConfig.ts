import { useCallback, useEffect, useMemo, useState } from 'react';

export type ProjectRunConfigStatus = 'idle' | 'generating' | 'ready' | 'failed';

type ProjectRunConfigState = {
  projectId: string;
  status: ProjectRunConfigStatus;
  exists: boolean;
  provider?: string | null;
  error?: string | null;
  updatedAt?: string | null;
};

export function useProjectRunConfig(args: {
  projectId: string | null;
  projectPath: string | null;
  preferredProvider: string | null;
}) {
  const { projectId, projectPath, preferredProvider } = args;

  const [state, setState] = useState<ProjectRunConfigState | null>(null);

  const status: ProjectRunConfigStatus = state?.status ?? 'idle';
  const error = state?.error ?? null;

  // In future we may support env setup at the project level; keep a placeholder for now.
  const env = useMemo<Record<string, string> | null>(() => null, []);

  const refresh = useCallback(async () => {
    if (!projectId || !projectPath) return null;
    const res = await window.electronAPI.worktreeRunGetProjectConfigStatus({
      projectId,
      projectPath,
    });
    if (res?.ok && res.state) {
      setState(res.state);
      return res.state;
    }
    return null;
  }, [projectId, projectPath]);

  const ensure = useCallback(
    async ({ force }: { force: boolean }) => {
      if (!projectId || !projectPath) return null;
      const res = await window.electronAPI.worktreeRunEnsureProjectConfig({
        projectId,
        projectPath,
        preferredProvider: preferredProvider || undefined,
        force,
      });
      if (res?.ok && res.state) {
        setState(res.state);
        return res.state;
      }
      return null;
    },
    [projectId, projectPath, preferredProvider]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const off = window.electronAPI.onWorktreeRunEvent((event) => {
      if (event?.type !== 'config' || !event?.state) return;
      if (!projectId) return;
      if (event.state.projectId !== projectId) return;
      setState(event.state);
    });
    return () => off?.();
  }, [projectId]);

  return {
    status,
    error,
    env,
    refresh,
    ensure,
  };
}


