import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { rpc } from '@renderer/core/ipc';

export function useFileDiff(
  projectId: string,
  taskId: string,
  filePath: string,
  isStaged: boolean,
  enabled = true
) {
  return useQuery({
    queryKey: ['git', 'diff', isStaged ? 'staged' : 'unstaged', projectId, taskId, filePath],
    queryFn: async () => {
      const result = await rpc.git.getFileDiff(
        projectId,
        taskId,
        filePath,
        isStaged ? 'staged' : undefined
      );
      if (!result.success) {
        throw new Error(
          result.error && 'message' in result.error ? result.error.message : 'Failed to load diff'
        );
      }
      return result.data.diff;
    },
    staleTime: 5000,
    enabled: enabled && !!projectId && !!taskId && !!filePath,
  });
}

/** Returns a stable callback that prefetches a file diff into the TanStack Query cache on hover. */
export function useOptimisticFileDiff(projectId: string, taskId: string) {
  const queryClient = useQueryClient();

  return useCallback(
    (filePath: string, isStaged: boolean) => {
      queryClient.prefetchQuery({
        queryKey: ['git', 'diff', isStaged ? 'staged' : 'unstaged', projectId, taskId, filePath],
        queryFn: async () => {
          const result = await rpc.git.getFileDiff(
            projectId,
            taskId,
            filePath,
            isStaged ? 'staged' : undefined
          );
          if (!result.success) {
            throw new Error(
              result.error && 'message' in result.error
                ? result.error.message
                : 'Failed to load diff'
            );
          }
          return result.data.diff;
        },
        staleTime: 5000,
      });
    },
    [queryClient, projectId, taskId]
  );
}
