import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { rpc } from '@renderer/core/ipc';
import { extractErrorMessage } from './utils';

export function useBranchStatus({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();

  const branchQuery = useQuery({
    queryKey: ['branch-status', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getBranchStatus(projectId, taskId);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      return result.data;
    },
    refetchInterval: 10000,
    staleTime: 5000,
  });

  const invalidateBranchStatus = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['branch-status', projectId, taskId] });
  }, [queryClient, projectId, taskId]);

  const invalidateGitChanges = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['git', 'changes', projectId, taskId] });
  }, [queryClient, projectId, taskId]);

  const fetchChanges = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const result = await rpc.git.fetch(projectId, taskId);
    if (result.success) {
      invalidateBranchStatus();
      return { success: true };
    }
    return { success: false, error: extractErrorMessage(result.error) };
  }, [projectId, taskId, invalidateBranchStatus]);

  const pullChanges = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const result = await rpc.git.pull(projectId, taskId);
    if (result.success) {
      invalidateBranchStatus();
      invalidateGitChanges();
      return { success: true };
    }
    return { success: false, error: extractErrorMessage(result.error) };
  }, [projectId, taskId, invalidateBranchStatus, invalidateGitChanges]);

  const pushChanges = useCallback(async (): Promise<{ success: boolean; error?: string }> => {
    const result = await rpc.git.push(projectId, taskId);
    if (result.success) {
      invalidateBranchStatus();
      return { success: true };
    }
    return { success: false, error: extractErrorMessage(result.error) };
  }, [projectId, taskId, invalidateBranchStatus]);

  return {
    isLoading: branchQuery.isLoading,
    data: branchQuery.data,
    fetchChanges,
    pullChanges,
    pushChanges,
  };
}
