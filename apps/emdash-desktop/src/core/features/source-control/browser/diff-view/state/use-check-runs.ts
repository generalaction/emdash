import { useEffect, useMemo } from 'react';
import { getPullRequestsRuntimeClient } from '@renderer/lib/runtime/pull-requests-client';
import { computeCheckRunsSummary, type CheckRun } from '@renderer/utils/github';
import type { PullRequest } from '@root/src/core/services/pull-requests/api';

export function useSyncCheckRuns(pr: PullRequest) {
  const checks = useMemo(() => pr.checks as CheckRun[], [pr.checks]);
  const summary = useMemo(() => computeCheckRunsSummary(checks), [checks]);

  useEffect(() => {
    void getPullRequestsRuntimeClient()
      .then(async (client) => {
        await client.syncChecks({
          repositoryUrl: pr.repositoryUrl,
          pullRequestUrl: pr.url,
          headRefOid: pr.headRefOid,
        });
      })
      .catch(() => {
        // The existing checks remain renderable when a background refresh fails.
      });
  }, [pr.headRefOid, pr.repositoryUrl, pr.url]);

  return {
    checks,
    summary,
    allComplete: summary.pending === 0,
    hasFailures: summary.failed > 0,
  };
}
