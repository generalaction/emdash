import { useQuery } from '@tanstack/react-query';
import { getPrNumber, pullRequestErrorMessage, type PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';

export function usePullRequestComments(pr: PullRequest) {
  const prNumber = getPrNumber(pr);

  return useQuery({
    queryKey: ['pull-request-comments', pr.repositoryUrl, prNumber],
    queryFn: async () => {
      if (prNumber === null) return [];

      const response = await rpc.pullRequests.getPullRequestComments(pr.repositoryUrl, prNumber);
      if (!response.success) {
        throw new Error(pullRequestErrorMessage(response.error));
      }
      return response.data.comments;
    },
    enabled: prNumber !== null,
    staleTime: 30_000,
  });
}
