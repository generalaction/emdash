import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import { linearConnectionService } from './linear-connection-service';

type LinearIssueNode = {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  branchName: string | null;
  state: { name: string; type: string; color: string } | null;
  team: { name: string; key: string } | null;
  project: { name: string } | null;
  assignee: { displayName: string; name: string } | null;
  updatedAt: string;
};

const ISSUES_QUERY = `
  query ListIssues($limit: Int!) {
    issues(
      first: $limit,
      orderBy: updatedAt,
      filter: { state: { type: { nin: ["completed", "cancelled"] } } }
    ) {
      nodes {
        id
        identifier
        title
        description
        url
        branchName
        state { name type color }
        team { name key }
        project { name }
        assignee { displayName name }
        updatedAt
      }
    }
  }
`;

const SEARCH_QUERY = `
  query SearchIssues($term: String!, $limit: Int!) {
    searchIssues(term: $term, first: $limit) {
      nodes {
        id
        identifier
        title
        description
        url
        branchName
        state { name type color }
        team { name key }
        project { name }
        assignee { displayName name }
        updatedAt
      }
    }
  }
`;

function toIssue(raw: LinearIssueNode): Issue {
  return {
    provider: 'linear',
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url ?? '',
    description: raw.description ?? undefined,
    branchName: raw.branchName ?? undefined,
    status: raw.state?.name ?? undefined,
    assignees: raw.assignee
      ? [raw.assignee.name ?? raw.assignee.displayName].filter(Boolean)
      : undefined,
    project: raw.project?.name ?? undefined,
    updatedAt: raw.updatedAt ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(limit = 50): Promise<IssueListResult> {
  const client = await linearConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Linear token not set. Connect Linear in settings first.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 50, 200);

  try {
    const { data } = await client.client.rawRequest<
      { issues: { nodes: LinearIssueNode[] } },
      { limit: number }
    >(ISSUES_QUERY, { limit: sanitizedLimit });

    return {
      success: true,
      issues: (data?.issues?.nodes ?? []).map(toIssue),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to fetch Linear issues.';
    return { success: false, error: message };
  }
}

async function searchIssues(searchTerm: string, limit = 20): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term) {
    return { success: true, issues: [] };
  }

  const client = await linearConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Linear token not set. Connect Linear in settings first.' };
  }

  const sanitizedLimit = clampIssueLimit(limit, 20, 200);

  try {
    const { data } = await client.client.rawRequest<
      { searchIssues: { nodes: LinearIssueNode[] } },
      { term: string; limit: number }
    >(SEARCH_QUERY, {
      term,
      limit: sanitizedLimit,
    });

    return {
      success: true,
      issues: (data?.searchIssues?.nodes ?? []).map(toIssue),
    };
  } catch (error) {
    log.error('[Linear] searchIssues error:', error);
    return { success: true, issues: [] };
  }
}

export const linearIssueProvider: IssueProvider = {
  type: 'linear',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,

  checkConnection: () => linearConnectionService.checkConnection(),

  listIssues: async (opts) => listIssues(opts.limit ?? 50),

  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
