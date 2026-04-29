import { githubIssueProvider } from '@main/core/github/github-issue-provider';
import { diffIssuesAgainstCursor } from './issue-helpers';
import { listProjectScmTargets } from './scm-helpers';
import type { Poller, PollerCursor, PollerResult } from './types';

export const githubPoller: Poller = {
  async poll(projectId: string, cursor: PollerCursor | null): Promise<PollerResult> {
    return diffIssuesAgainstCursor('github', projectId, cursor, async () => {
      const targets = await listProjectScmTargets(projectId, 'github');
      const reachableTargets = targets.filter((target) => target.nameWithOwner);
      if (reachableTargets.length === 0) return { ok: true, issues: [] };

      const results = await Promise.all(
        reachableTargets.map((target) =>
          githubIssueProvider.listIssues({
            projectId,
            nameWithOwner: target.nameWithOwner,
            limit: 50,
          })
        )
      );

      const collected = results.flatMap((result) => (result.success ? result.issues : []));
      return { ok: true, issues: collected };
    });
  },
};
