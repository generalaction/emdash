import { issueListIssues, type Issue as ForgejoIssue } from '@llamaduck/forgejo-ts';
import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import {
  clampIssueLimit,
  normalizeSearchTerm,
  requireProjectPath,
} from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { forgejoConnectionService, toForgejoErrorMessage } from './forgejo-connection-service';

function toIssue(issue: ForgejoIssue, repoName: string): Issue {
  const assignee = issue.assignee;
  const assigneeName = assignee?.full_name || assignee?.login;
  const assigneeLogin = assignee?.login || assignee?.full_name;

  return {
    provider: 'forgejo',
    identifier: `#${issue.number ?? 0}`,
    title: issue.title ?? '',
    url: issue.html_url ?? '',
    description: issue.body ?? undefined,
    status: issue.state ?? undefined,
    assignees: assigneeName || assigneeLogin ? [assigneeName ?? assigneeLogin ?? ''] : undefined,
    project: repoName,
    updatedAt: issue.updated_at ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(projectPath: string, limit: number): Promise<IssueListResult> {
  const perPage = clampIssueLimit(limit, 50, 100);

  try {
    const { client, owner, repo, repoName } =
      await forgejoConnectionService.resolveRepo(projectPath);

    const { data: issues } = await issueListIssues({
      client,
      path: { owner, repo },
      query: { state: 'open', type: 'issues', sort: 'recentupdate', limit: perPage },
      throwOnError: true,
    });

    return {
      success: true,
      issues: (issues ?? []).map((issue) => toIssue(issue, repoName)),
    };
  } catch (error) {
    return {
      success: false,
      error: toForgejoErrorMessage(error, 'Failed to fetch Forgejo issues.'),
    };
  }
}

async function searchIssues(
  projectPath: string,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const perPage = clampIssueLimit(limit, 20, 100);

  try {
    const { client, owner, repo, repoName } =
      await forgejoConnectionService.resolveRepo(projectPath);

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

    return {
      success: true,
      issues: (issues ?? []).map((issue) => toIssue(issue, repoName)),
    };
  } catch (error) {
    return {
      success: false,
      error: toForgejoErrorMessage(error, 'Failed to search Forgejo issues.'),
    };
  }
}

export const forgejoIssueProvider: IssueProvider = {
  type: 'forgejo',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.forgejo,

  checkConnection: () => forgejoConnectionService.checkConnection(),

  listIssues: async (opts) => {
    const projectPath = requireProjectPath(opts.projectPath);
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    return listIssues(projectPath, opts.limit ?? 50);
  },

  searchIssues: async (opts) => {
    const projectPath = requireProjectPath(opts.projectPath);
    if (!projectPath) {
      return { success: false, error: 'Project path is required.' };
    }

    return searchIssues(projectPath, opts.searchTerm, opts.limit ?? 20);
  },
};
