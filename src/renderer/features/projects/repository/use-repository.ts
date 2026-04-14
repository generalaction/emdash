import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { GitHeadState } from '@shared/git';
import { rpc } from '@renderer/lib/ipc';

export function useRepository(projectId: string | undefined) {
  const { data: branches } = useQuery({
    queryKey: ['repository', 'branches', projectId],
    queryFn: () => rpc.repository.getBranches(projectId!),
    enabled: !!projectId,
  });
  const { data: defaultBranch } = useQuery({
    queryKey: ['repository', 'defaultBranch', projectId],
    queryFn: () => rpc.repository.getDefaultBranch(projectId!),
    enabled: !!projectId,
  });
  const { data: headState } = useQuery({
    queryKey: ['repository', 'headState', projectId],
    queryFn: () => rpc.repository.getHeadState(projectId!) as Promise<GitHeadState | undefined>,
    enabled: !!projectId,
  });
  return { branches: branches ?? [], defaultBranch, headState };
}

export function usePrefetchRepository(projectId: string) {
  const queryClient = useQueryClient();

  const prefetch = useCallback(() => {
    queryClient.prefetchQuery({
      queryKey: ['repository', 'branches', projectId],
      queryFn: () => rpc.repository.getBranches(projectId),
    });
    queryClient.prefetchQuery({
      queryKey: ['repository', 'defaultBranch', projectId],
      queryFn: () => rpc.repository.getDefaultBranch(projectId),
    });
    queryClient.prefetchQuery({
      queryKey: ['repository', 'headState', projectId],
      queryFn: () => rpc.repository.getHeadState(projectId) as Promise<GitHeadState | undefined>,
    });
  }, [queryClient, projectId]);

  return { prefetch };
}
