import { useQuery } from '@tanstack/react-query';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import {
  getPrNumber,
  pullRequestErrorMessage,
  type PullRequest,
} from '@root/src/core/services/pull-requests/api';

export function usePullRequestComments(projectId: string, pr: PullRequest) {
  const prNumber = getPrNumber(pr);

  return useQuery({
    queryKey: ['pull-request-comments', projectId, pr.repositoryUrl, prNumber],
    queryFn: async () => {
      if (prNumber === null) return [];

      const client = await getPullRequestsRuntimeClient();
      const response = await client.getPullRequestComments({
        repositoryUrl: pr.repositoryUrl,
        number: prNumber,
      });
      if (!response.success) {
        throw new Error(pullRequestErrorMessage(response.error));
      }
      return response.data.comments;
    },
    enabled: prNumber !== null,
    staleTime: 30_000,
  });
}
