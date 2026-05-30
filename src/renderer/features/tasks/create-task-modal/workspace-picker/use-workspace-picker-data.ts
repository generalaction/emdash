import { useQueries, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { rpc } from '@renderer/lib/ipc';
import type { RepoInstance } from '@shared/projects';
import type { WorktreeEntry } from '@shared/workspaces';

export type WorkspacePickerData = {
  primaryWorktrees: WorktreeEntry[] | undefined;
  instances: RepoInstance[] | undefined;
  instanceWorktreeMap: Record<string, WorktreeEntry[] | undefined>;
  taskCounts: Record<string, number> | undefined;
  systemInfo: { username: string; homedir: string; hostname: string } | undefined;
  connectionNameMap: Record<string, string>;
  isPending: boolean;
};

export function useWorkspacePickerData(projectId: string | undefined): WorkspacePickerData {
  const { data: primaryWorktrees } = useQuery({
    queryKey: ['listWorktrees', projectId],
    queryFn: () => rpc.projects.listWorktrees(projectId!),
    enabled: !!projectId,
    refetchOnWindowFocus: false,
  });

  const { data: instances, isPending: instancesPending } = useQuery({
    queryKey: ['listRepoInstances', projectId],
    queryFn: () => rpc.projects.listRepoInstances(projectId!),
    enabled: !!projectId,
  });

  const { data: taskCounts } = useQuery({
    queryKey: ['workspaceTaskCounts', projectId],
    queryFn: () => rpc.projects.getWorkspaceTaskCounts(projectId!),
    enabled: !!projectId,
  });

  const { data: systemInfo } = useQuery({
    queryKey: ['systemInfo'],
    queryFn: () => rpc.app.getSystemInfo(),
    staleTime: Infinity,
  });

  const { data: sshConnections } = useQuery({
    queryKey: ['sshConnections'],
    queryFn: () => rpc.ssh.getConnections(),
    staleTime: Infinity,
  });

  const connectionNameMap = useMemo(
    () => Object.fromEntries((sshConnections ?? []).map((c) => [c.id, c.name])),
    [sshConnections]
  );

  const instanceWorktreeResults = useQueries({
    queries: (instances ?? []).map((inst) => ({
      queryKey: ['listWorktreesForInstance', projectId, inst.id],
      queryFn: () => rpc.projects.listWorktreesForInstance(projectId!, inst.id),
      enabled: !!projectId && !!inst.path,
      refetchOnWindowFocus: false,
    })),
  });

  const instanceWorktreeMap = useMemo<Record<string, WorktreeEntry[] | undefined>>(() => {
    const map: Record<string, WorktreeEntry[] | undefined> = {};
    for (let i = 0; i < (instances ?? []).length; i++) {
      const inst = instances![i]!;
      map[inst.id] = instanceWorktreeResults[i]?.data;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances, instanceWorktreeResults]);

  const isPending = instancesPending;

  return {
    primaryWorktrees,
    instances,
    instanceWorktreeMap,
    taskCounts,
    systemInfo,
    connectionNameMap,
    isPending,
  };
}
