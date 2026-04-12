import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import { plainConnectionService, toPlainErrorMessage } from './plain-connection-service';

type PlainThreadLike = {
  id: string;
  ref?: string | null;
  title?: string | null;
  previewText?: string | null;
  description?: string | null;
  status?: string | null;
  updatedAt?: { iso8601: string } | null;
};

function toIssue(thread: PlainThreadLike): Issue {
  return {
    provider: 'plain',
    identifier: thread.ref ?? thread.id,
    title: thread.title ?? '',
    url: '',
    description: thread.previewText ?? thread.description ?? undefined,
    status: thread.status ?? undefined,
    updatedAt: thread.updatedAt?.iso8601 ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
}

async function listIssues(limit: number): Promise<IssueListResult> {
  const client = await plainConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Plain is not configured. Connect Plain in settings.' };
  }

  const first = clampIssueLimit(limit, 50, 100);

  try {
    const connection = await client.query.threads({
      filters: { statuses: ['TODO'] },
      sortBy: { field: 'CREATED_AT', direction: 'DESC' },
      first,
    });

    return {
      success: true,
      issues: connection.nodes.map((thread) => toIssue(thread as PlainThreadLike)),
    };
  } catch (error) {
    return {
      success: false,
      error: toPlainErrorMessage(error, 'Failed to fetch Plain threads.'),
    };
  }
}

async function searchIssues(searchTerm: string, limit: number): Promise<IssueListResult> {
  const term = normalizeSearchTerm(searchTerm);
  if (!term || term.length < 2) {
    return { success: true, issues: [] };
  }

  const client = await plainConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Plain is not configured. Connect Plain in settings.' };
  }

  const first = clampIssueLimit(limit, 20, 100);

  try {
    const result = await client.query.searchThreads({
      searchQuery: { term },
      first,
    });

    if (!result?.edges) {
      return { success: true, issues: [] };
    }

    return {
      success: true,
      issues: result.edges.map((edge) => toIssue(edge.node.thread as PlainThreadLike)),
    };
  } catch (error) {
    log.error('[Plain] searchThreads error:', error);
    return { success: true, issues: [] };
  }
}

export const plainIssueProvider: IssueProvider = {
  type: 'plain',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.plain,

  checkConnection: () => plainConnectionService.checkConnection(),

  listIssues: async (opts) => listIssues(opts.limit ?? 50),

  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),
};
