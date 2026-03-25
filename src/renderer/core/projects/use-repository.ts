import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { rpc } from '@renderer/core/ipc';

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
  return { branches: branches ?? [], defaultBranch };
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
  }, [queryClient, projectId]);

  return { prefetch };
}
