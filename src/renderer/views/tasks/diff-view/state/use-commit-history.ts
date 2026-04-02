import { useQuery } from '@tanstack/react-query';
import { rpc } from '@renderer/core/ipc';
import { extractErrorMessage } from '../../../../core/git/utils';

export function useCommitHistory({ projectId, taskId }: { projectId: string; taskId: string }) {
  const commitHistoryQuery = useQuery({
    queryKey: ['commit-history', projectId, taskId],
    queryFn: async () => {
      const result = await rpc.git.getLog(projectId, taskId);
      if (!result.success) throw new Error(extractErrorMessage(result.error));
      return result.data.commits;
    },
  });

  return {
    isLoading: commitHistoryQuery.isLoading,
    commits: commitHistoryQuery.data ?? [],
  };
}
