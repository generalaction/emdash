import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { rpc } from '@renderer/lib/ipc';

export function useRepository(projectId: string) {
  const { data: branches } = useQuery({
    queryKey: ['repository', 'branches', projectId],
    queryFn: () => rpc.repository.getBranches(projectId),
  });
  const { data: defaultBranch } = useQuery({
    queryKey: ['repository', 'defaultBranch', projectId],
    queryFn: () => rpc.repository.getDefaultBranch(projectId),
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
