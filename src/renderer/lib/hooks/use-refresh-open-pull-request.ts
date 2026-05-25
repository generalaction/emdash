import { useQuery } from '@tanstack/react-query';
import { getPrNumber, pullRequestErrorMessage, type PullRequest } from '@shared/pull-requests';
import { rpc } from '@renderer/lib/ipc';

/** Matches main-process active-task PR sync cadence. */
export const OPEN_PULL_REQUEST_REFRESH_INTERVAL_MS = 15_000;

/**
 * Periodically refresh an open PR from GitHub. Updates flow through `prUpdatedChannel`
 * into task state; this hook only triggers the sync.
 */
export function useRefreshOpenPullRequest(
  pr: PullRequest | undefined,
  options?: { intervalMs?: number; enabled?: boolean }
): void {
  const prNumber = pr ? getPrNumber(pr) : null;
  const intervalMs = options?.intervalMs ?? OPEN_PULL_REQUEST_REFRESH_INTERVAL_MS;
  const enabled =
    (options?.enabled ?? true) &&
    pr?.status === 'open' &&
    prNumber != null &&
    Boolean(pr?.repositoryUrl);

  useQuery({
    queryKey: ['pull-request-refresh', pr?.repositoryUrl, prNumber],
    queryFn: async () => {
      if (!pr || prNumber == null) return null;
      const response = await rpc.pullRequests.refreshPullRequest(pr.repositoryUrl, prNumber);
      if (!response.success) {
        throw new Error(pullRequestErrorMessage(response.error));
      }
      return response.data.pr;
    },
    enabled,
    refetchInterval: intervalMs,
    staleTime: intervalMs,
  });
}
