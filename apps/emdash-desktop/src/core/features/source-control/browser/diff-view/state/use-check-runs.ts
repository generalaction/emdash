import { useEffect, useMemo } from 'react';
import { computeCheckRunsSummary, type CheckRun } from '@core/features/github/api/browser/checks';
import type { PullRequest } from '@core/services/pull-requests/api';
import { getPullRequestsRuntimeClient } from '@core/services/pull-requests/api/client';

export const CHECK_RUN_POLL_INTERVAL_MS = 10_000;

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
      if (disposed || inFlight || !client) return;
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
        hasRunning = result.success && result.data.hasRunning;
      } catch {
        hasRunning = false;
        // The existing checks remain renderable when a background refresh fails.
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
