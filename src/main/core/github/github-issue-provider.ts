import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import {
  normalizeSearchTerm,
  requireNameWithOwner,
} from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { githubConnectionService } from './services/github-connection-service';
import { issueService } from './services/issue-service';

function toIssue(raw: {
  number: number;
  title: string;
  url: string;
  state: string;
  updatedAt: string | null;
  assignees: Array<{ login: string }>;
  body?: string | null;
}): Issue {
  return {
    provider: 'github',
    identifier: `#${raw.number}`,
    title: raw.title,
    url: raw.url,
    description: raw.body ?? undefined,
    status: raw.state,
    assignees: raw.assignees.map((assignee) => assignee.login).filter(Boolean),
    updatedAt: raw.updatedAt ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(nameWithOwner: string, limit: number): Promise<IssueListResult> {
  try {
    const issues = await issueService.listIssues(nameWithOwner, limit);
    return {
      success: true,
      issues: issues.map(toIssue),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to list GitHub issues',
    };
  }
}

async function searchIssues(
  nameWithOwner: string,
  searchTerm: string,
  limit: number
): Promise<IssueListResult> {
  if (!normalizeSearchTerm(searchTerm)) {
    return { success: true, issues: [] };
  }

  try {
    const issues = await issueService.searchIssues(nameWithOwner, searchTerm, limit);
    return {
      success: true,
      issues: issues.map(toIssue),
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to search GitHub issues',
    };
  }
}

export const githubIssueProvider: IssueProvider = {
  type: 'github',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.github,

  checkConnection: async () => {
    const status = await githubConnectionService.getStatus();
    return {
      connected: status.authenticated,
      displayName: status.user?.login || status.user?.name || undefined,
      capabilities: ISSUE_PROVIDER_CAPABILITIES.github,
    };
  },

  listIssues: async (opts) => {
    const nameWithOwner = requireNameWithOwner(opts.nameWithOwner);
    if (!nameWithOwner) {
      return { success: false, error: 'Repository name is required.' };
    }

    return listIssues(nameWithOwner, opts.limit ?? 50);
  },

  searchIssues: async (opts) => {
    const nameWithOwner = requireNameWithOwner(opts.nameWithOwner);
    if (!nameWithOwner) {
      return { success: false, error: 'Repository name is required.' };
    }

    return searchIssues(nameWithOwner, opts.searchTerm, opts.limit ?? 20);
  },
};
