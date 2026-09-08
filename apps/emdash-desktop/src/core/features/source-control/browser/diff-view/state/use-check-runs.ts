import { useEffect, useMemo } from 'react';
import { computeCheckRunsSummary, type CheckRun } from '@core/features/github/api/browser/checks';
import type { PullRequest, PullRequestError } from '@core/services/pull-requests/api';
import { getPullRequestsRuntimeClient } from '@core/services/pull-requests/api/client';

export const CHECK_RUN_POLL_INTERVAL_MS = 10_000;

const retryableCheckSyncErrors = new Set<PullRequestError['type']>([
  'host_unreachable',
  'github_rate_limited',
  'checks_failed',
]);

export function useSyncCheckRuns(pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  useEffect(() => {
    let disposed = false;
    let hasRunning = true;
    let inFlight = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let client: Awaited<ReturnType<typeof getPullRequestsRuntimeClient>> | undefined;
    const controller = new AbortController();

    const clearPollTimer = () => {
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      pollTimer = undefined;
    };

    const schedulePoll = () => {
      clearPollTimer();
      if (disposed || document.hidden || !hasRunning) return;
      pollTimer = setTimeout(() => {
        pollTimer = undefined;
        void sync();
      }, CHECK_RUN_POLL_INTERVAL_MS);
    };

    const sync = async () => {
      if (disposed || document.hidden || inFlight || !client) return;
      inFlight = true;
      try {
        const result = await client.syncChecks(
          {
            repositoryUrl: pr.repositoryUrl,
            pullRequestUrl: pr.url,
            headRefOid: pr.headRefOid,
          },
          { signal: controller.signal }
        );
        if (result.success) {
          hasRunning = result.data.hasRunning;
        } else if (!retryableCheckSyncErrors.has(result.error.type)) {
          hasRunning = false;
        }
      } catch {
        // A failed refresh does not prove that active checks have completed.
      } finally {
        inFlight = false;
        schedulePoll();
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        clearPollTimer();
      } else if (hasRunning) {
        void sync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    void getPullRequestsRuntimeClient()
      .then((runtimeClient) => {
        if (disposed) return;
        client = runtimeClient;
        void sync();
      })
      .catch(() => {
        hasRunning = false;
        // The existing checks remain renderable when a background refresh fails.
      });

    return () => {
      disposed = true;
      controller.abort();
      clearPollTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [pr.headRefOid, pr.repositoryUrl, pr.url]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
  };
}
