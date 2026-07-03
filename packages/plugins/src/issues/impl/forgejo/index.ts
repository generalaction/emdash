import { err, ok } from '@emdash/shared';
import { issueListIssues, type Issue as ForgejoIssue } from '@llamaduck/forgejo-ts';
import { RemoteHostMismatchError } from '../../../integrations/helpers/hosted-instance';
import {
  resolveForgejoRepo,
  toForgejoErrorMessage,
} from '../../../integrations/impl/forgejo/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueError } from '../../types';

function toForgejoIssueError(error: unknown, fallback: string): IssueError {
  if (error instanceof RemoteHostMismatchError) {
    return issueError('unsupported_host', error.message);
  }
  return issueError('generic', toForgejoErrorMessage(error, fallback));
}

function toIssue(issue: ForgejoIssue, repoName: string): IssueData {
  const assignee = issue.assignee;
  const assigneeName = assignee?.full_name || assignee?.login;
  const assigneeLogin = assignee?.login || assignee?.full_name;

  return {
    identifier: `#${issue.number ?? 0}`,
    title: issue.title ?? '',
    url: issue.html_url ?? '',
    description: issue.body ?? undefined,
    status: issue.state ?? undefined,
    assignees: assigneeName || assigneeLogin ? [assigneeName ?? assigneeLogin ?? ''] : undefined,
    project: repoName,
    updatedAt: issue.updated_at ?? undefined,
  };
}

const plugin = defineIssuesPlugin(
  { integrationId: 'forgejo' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      const perPage = clampIssueLimit(opts.limit, 50, 100);

      try {
        const { client, owner, repo, repoName } = await resolveForgejoRepo(
          host.credentials,
          opts.repositoryUrl
        );
        const { data: issues } = await issueListIssues({
          client,
          path: { owner, repo },
          query: { state: 'open', type: 'issues', sort: 'recentupdate', limit: perPage },
          throwOnError: true,
        });

        return ok((issues ?? []).map((issue) => toIssue(issue, repoName)));
      } catch (error) {
        return err(toForgejoIssueError(error, 'Failed to fetch Forgejo issues.'));
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const perPage = clampIssueLimit(opts.limit, 20, 100);

      try {
        const { client, owner, repo, repoName } = await resolveForgejoRepo(
          host.credentials,
          opts.repositoryUrl
        );
        const { data: issues } = await issueListIssues({
          client,
          path: { owner, repo },
          query: {
            state: 'open',
            type: 'issues',
            q: term,
            sort: 'recentupdate',
            limit: perPage,
          },
          throwOnError: true,
        });

        return ok((issues ?? []).map((issue) => toIssue(issue, repoName)));
      } catch (error) {
        return err(toForgejoIssueError(error, 'Failed to search Forgejo issues.'));
      }
    },
  },
});
