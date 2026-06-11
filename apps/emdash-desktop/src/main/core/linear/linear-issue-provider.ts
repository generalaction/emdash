import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import type { LinkedIssue } from '@shared/core/linked-issue';
import {
  ISSUE_PROVIDER_CAPABILITIES,
  type IssueAttachment,
  type IssueContextResult,
  type IssueListResult,
} from '@shared/issue-providers';
import { linearConnectionService } from './linear-connection-service';
import {
  formatLinearContext,
  hydrateIssueActivity,
  LINEAR_ISSUE_ACTIVITY_FIELDS,
  type LinearIssueWithActivity,
} from './linear-issue-activity';
import { downloadLinearIssueAttachments } from './linear-issue-attachments';

type LinearIssueSummaryNode = {
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

type LinearIssueContextNode = LinearIssueWithActivity<LinearIssueSummaryNode>;

const ISSUE_SUMMARY_FRAGMENT = `
  fragment IssueSummary on Issue {
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
`;

const ISSUES_QUERY = `
  ${ISSUE_SUMMARY_FRAGMENT}

  query ListIssues($limit: Int!) {
    issues(
      first: $limit,
      orderBy: updatedAt,
      filter: { state: { type: { nin: ["completed", "cancelled"] } } }
    ) {
      nodes {
        ...IssueSummary
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

const ISSUE_CONTEXT_QUERY = `
  query IssueContext($term: String!, $limit: Int!) {
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
        ${LINEAR_ISSUE_ACTIVITY_FIELDS}
      }
    }
  }
`;

function toIssue(raw: LinearIssueSummaryNode, context?: string): LinkedIssue {
  return {
    provider: 'linear',
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url ?? '',
    description: raw.description ?? undefined,
    context,
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
      { issues: { nodes: LinearIssueSummaryNode[] } },
      { limit: number }
    >(ISSUES_QUERY, { limit: sanitizedLimit });

    return {
      success: true,
      issues: (data?.issues?.nodes ?? []).map((issue) => toIssue(issue)),
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
      { searchIssues: { nodes: LinearIssueSummaryNode[] } },
      { term: string; limit: number }
    >(SEARCH_QUERY, {
      term,
      limit: sanitizedLimit,
    });

    return {
      success: true,
      issues: (data?.searchIssues?.nodes ?? []).map((issue) => toIssue(issue)),
    };
  } catch (error) {
    log.error('[Linear] searchIssues error:', error);
    const message = error instanceof Error ? error.message : 'Unable to search Linear issues.';
    return { success: false, error: message };
  }
}

async function getIssueContext(identifier: string): Promise<IssueContextResult> {
  const term = normalizeSearchTerm(identifier);
  if (!term) {
    return { success: false, error: 'Linear issue identifier is required.' };
  }

  const client = await linearConnectionService.getClient();
  if (!client) {
    return { success: false, error: 'Linear token not set. Connect Linear in settings first.' };
  }

  try {
    const { data } = await client.client.rawRequest<
      { searchIssues: { nodes: LinearIssueContextNode[] } },
      { term: string; limit: number }
    >(ISSUE_CONTEXT_QUERY, {
      term,
      limit: 3,
    });
    const exactIssue = (data?.searchIssues?.nodes ?? []).find((issue) => issue.identifier === term);

    if (!exactIssue) {
      return { success: false, error: `Linear issue not found: ${term}` };
    }

    let hydratedIssue = exactIssue;
    try {
      hydratedIssue = await hydrateIssueActivity(client, exactIssue);
    } catch (error) {
      log.warn('[Linear] failed to hydrate issue activity:', {
        issueId: exactIssue.id,
        identifier: exactIssue.identifier,
        error,
      });
    }

    let attachments: IssueAttachment[] = [];
    try {
      attachments = await downloadIssueAttachments(hydratedIssue);
    } catch (error) {
      log.warn('[Linear] failed to download issue attachments:', {
        issueId: hydratedIssue.id,
        identifier: hydratedIssue.identifier,
        error,
      });
    }

    return {
      success: true,
      issue: toIssue(hydratedIssue, formatLinearContext(hydratedIssue)),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
  } catch (error) {
    log.error('[Linear] getIssueContext error:', error);
    const message =
      error instanceof Error ? error.message : 'Unable to fetch Linear issue context.';
    return { success: false, error: message };
  }
}

async function downloadIssueAttachments(issue: LinearIssueContextNode): Promise<IssueAttachment[]> {
  const token = await linearConnectionService.getToken();
  if (!token) return [];

  return downloadLinearIssueAttachments({
    token,
    identifier: issue.identifier,
    texts: [issue.description, ...(issue.comments?.nodes ?? []).map((c) => c.body)].filter(
      (text): text is string => text != null
    ),
  });
}

export const linearIssueProvider: IssueProvider = {
  type: 'linear',
  capabilities: ISSUE_PROVIDER_CAPABILITIES.linear,

  isConfigured: () => linearConnectionService.isConfigured(),

  checkConnection: () => linearConnectionService.checkConnection(),

  listIssues: async (opts) => listIssues(opts.limit ?? 50),

  searchIssues: async (opts) => searchIssues(opts.searchTerm, opts.limit ?? 20),

  getIssueContext: async (opts) => getIssueContext(opts.identifier),
};
