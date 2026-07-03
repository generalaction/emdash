import { err, ok } from '@emdash/shared';
import { RemoteHostMismatchError } from '../../../integrations/helpers/hosted-instance';
import {
  resolveGitLabProject,
  toGitLabErrorMessage,
} from '../../../integrations/impl/gitlab/client';
import { clampIssueLimit, issueError, normalizeSearchTerm } from '../../helpers/provider-inputs';
import { defineIssuesPlugin, registerIssuesPluginBehavior } from '../../plugin';
import type { IssueData, IssueError } from '../../types';

function toGitLabIssueError(error: unknown, fallback: string): IssueError {
  if (error instanceof RemoteHostMismatchError) {
    return issueError('unsupported_host', error.message);
  }
  return issueError('generic', toGitLabErrorMessage(error, fallback));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toIssue(raw: unknown, projectName: string | null): IssueData | null {
  const item = asRecord(raw);
  if (!item) return null;

  const iid = readNumber(item.iid);
  if (iid === null) return null;

  const assigneeRecord =
    asRecord(item.assignee) ?? (Array.isArray(item.assignees) ? asRecord(item.assignees[0]) : null);
  const assigneeName = readString(assigneeRecord?.name) ?? readString(assigneeRecord?.username);
  const assigneeUsername =
    readString(assigneeRecord?.username) ?? readString(assigneeRecord?.name) ?? undefined;

  return {
    identifier: `#${iid}`,
    title: readString(item.title) ?? '',
    url: readString(item.web_url) ?? readString(item.webUrl) ?? '',
    description: readString(item.description) ?? undefined,
    status: readString(item.state) ?? undefined,
    assignees:
      assigneeName || assigneeUsername ? [assigneeName ?? assigneeUsername ?? ''] : undefined,
    project: projectName ?? undefined,
    updatedAt: readString(item.updated_at) ?? readString(item.updatedAt) ?? undefined,
  };
}

const plugin = defineIssuesPlugin(
  { integrationId: 'gitlab' },
  { issues: { requiredInputs: ['repositoryUrl'] } },
  {}
);

export const provider = registerIssuesPluginBehavior(plugin, {
  issues: {
    async listIssues(host, opts) {
      const perPage = clampIssueLimit(opts.limit, 50, 100);

      try {
        const { client, projectId, projectName } = await resolveGitLabProject(
          host.credentials,
          opts.repositoryUrl
        );
        const issues = (await client.Issues.all({
          projectId,
          state: 'opened',
          orderBy: 'updated_at',
          sort: 'desc',
          perPage,
          maxPages: 1,
        })) as unknown[];

        return ok(
          (issues ?? [])
            .map((issue) => toIssue(issue, projectName))
            .filter((issue): issue is IssueData => issue !== null)
        );
      } catch (error) {
        return err(toGitLabIssueError(error, 'Failed to fetch GitLab issues.'));
      }
    },

    async searchIssues(host, opts) {
      const term = normalizeSearchTerm(opts.searchTerm);
      if (!term) return ok([]);

      const perPage = clampIssueLimit(opts.limit, 20, 100);

      try {
        const { client, projectId, projectName } = await resolveGitLabProject(
          host.credentials,
          opts.repositoryUrl
        );
        const issues = (await client.Issues.all({
          projectId,
          state: 'opened',
          search: term,
          in: 'title,description',
          orderBy: 'updated_at',
          sort: 'desc',
          perPage,
          maxPages: 1,
        })) as unknown[];

        return ok(
          (issues ?? [])
            .map((issue) => toIssue(issue, projectName))
            .filter((issue): issue is IssueData => issue !== null)
        );
      } catch (error) {
        return err(toGitLabIssueError(error, 'Failed to search GitLab issues.'));
      }
    },
  },
});
