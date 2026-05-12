import { ISSUE_PROVIDER_CAPABILITIES, type IssueListResult } from '@shared/issue-providers';
import type { Issue } from '@shared/tasks';
import { clampIssueLimit, normalizeSearchTerm } from '@main/core/issues/helpers/provider-inputs';
import type { IssueProvider } from '@main/core/issues/issue-provider';
import { log } from '@main/lib/logger';
import { linearConnectionService } from './linear-connection-service';

type LinearCommentNode = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  user: { displayName: string; name: string } | null;
};

type LinearPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

type LinearConnection<T> = {
  nodes: T[];
  pageInfo?: LinearPageInfo;
};

type LinearHistoryNode = {
  id: string;
  createdAt: string;
  updatedAt: string;
  actor: { displayName?: string | null; name?: string | null } | null;
  fromState?: { name: string } | null;
  toState?: { name: string } | null;
  fromAssignee?: { displayName: string; name: string } | null;
  toAssignee?: { displayName: string; name: string } | null;
  fromProject?: { name: string } | null;
  toProject?: { name: string } | null;
  fromCycle?: { name: string } | null;
  toCycle?: { name: string } | null;
  fromPriority?: number | null;
  toPriority?: number | null;
  fromEstimate?: number | null;
  toEstimate?: number | null;
  fromTitle?: string | null;
  toTitle?: string | null;
};

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
  comments: LinearConnection<LinearCommentNode>;
  history: LinearConnection<LinearHistoryNode>;
};

const ACTIVITY_PAGE_SIZE = 50;

const ISSUE_DETAILS_FRAGMENT = `
  fragment IssueDetails on Issue {
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
    comments(first: ${ACTIVITY_PAGE_SIZE}, orderBy: createdAt) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        body
        createdAt
        updatedAt
        url
        user { displayName name }
      }
    }
    history(first: ${ACTIVITY_PAGE_SIZE}, orderBy: createdAt) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        createdAt
        updatedAt
        actor { ... on User { displayName name } }
        fromState { name }
        toState { name }
        fromAssignee { displayName name }
        toAssignee { displayName name }
        fromProject { name }
        toProject { name }
        fromCycle { name }
        toCycle { name }
        fromPriority
        toPriority
        fromEstimate
        toEstimate
        fromTitle
        toTitle
      }
    }
  }
`;

const ISSUE_COMMENTS_QUERY = `
  query IssueComments($issueId: String!, $cursor: String) {
    issue(id: $issueId) {
      comments(first: ${ACTIVITY_PAGE_SIZE}, after: $cursor, orderBy: createdAt) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          body
          createdAt
          updatedAt
          url
          user { displayName name }
        }
      }
    }
  }
`;

const ISSUE_HISTORY_QUERY = `
  query IssueHistory($issueId: String!, $cursor: String) {
    issue(id: $issueId) {
      history(first: ${ACTIVITY_PAGE_SIZE}, after: $cursor, orderBy: createdAt) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          createdAt
          updatedAt
          actor { ... on User { displayName name } }
          fromState { name }
          toState { name }
          fromAssignee { displayName name }
          toAssignee { displayName name }
          fromProject { name }
          toProject { name }
          fromCycle { name }
          toCycle { name }
          fromPriority
          toPriority
          fromEstimate
          toEstimate
          fromTitle
          toTitle
        }
      }
    }
  }
`;

const ISSUES_QUERY = `
  ${ISSUE_DETAILS_FRAGMENT}

  query ListIssues($limit: Int!) {
    issues(
      first: $limit,
      orderBy: updatedAt,
      filter: { state: { type: { nin: ["completed", "cancelled"] } } }
    ) {
      nodes {
        ...IssueDetails
      }
    }
  }
`;

const SEARCH_QUERY = `
  ${ISSUE_DETAILS_FRAGMENT}

  query SearchIssues($term: String!, $limit: Int!) {
    searchIssues(term: $term, first: $limit) {
      nodes {
        ...IssueDetails
      }
    }
  }
`;

type NameLike = { displayName?: string | null; name?: string | null } | null | undefined;

function displayName(user: NameLike, fallback: string): string;
function displayName(user: NameLike): string | undefined;
function displayName(user: NameLike, fallback?: string): string | undefined {
  return user?.displayName ?? user?.name ?? fallback;
}

function formatTransition(
  label: string,
  from?: string | number | null,
  to?: string | number | null
) {
  if (from === undefined && to === undefined) return undefined;
  if (from === null && to === null) return undefined;
  if (from === to) return undefined;
  return `${label}: ${from ?? 'none'} -> ${to ?? 'none'}`;
}

function formatHistoryEntry(history: LinearHistoryNode): string {
  const changes = [
    formatTransition('State', history.fromState?.name, history.toState?.name),
    formatTransition(
      'Assignee',
      displayName(history.fromAssignee),
      displayName(history.toAssignee)
    ),
    formatTransition('Project', history.fromProject?.name, history.toProject?.name),
    formatTransition('Cycle', history.fromCycle?.name, history.toCycle?.name),
    formatTransition('Priority', history.fromPriority, history.toPriority),
    formatTransition('Estimate', history.fromEstimate, history.toEstimate),
    formatTransition('Title', history.fromTitle, history.toTitle),
  ].filter(Boolean);

  const summary = changes.length ? changes.join('; ') : 'Issue updated';
  return `- ${history.createdAt} by ${displayName(history.actor, 'Unknown')}: ${summary}`;
}

function formatLinearContext(raw: LinearIssueNode): string | undefined {
  const comments = raw.comments?.nodes ?? [];
  const history = raw.history?.nodes ?? [];
  if (comments.length === 0 && history.length === 0) return undefined;

  const parts = ['Linear issue activity'];

  if (comments.length > 0) {
    parts.push(
      '',
      'Comments:',
      ...comments.map(
        (comment) =>
          `- ${comment.createdAt} by ${displayName(comment.user, 'Unknown')}: ${comment.body.trim()}`
      )
    );
  }

  if (history.length > 0) {
    parts.push('', 'History:', ...history.map(formatHistoryEntry));
  }

  return parts.join('\n');
}

type LinearRawClient = {
  client: {
    rawRequest: <TData, TVariables extends Record<string, unknown>>(
      query: string,
      variables: TVariables
    ) => Promise<{ data?: TData }>;
  };
};

function nextCursor(connection: LinearConnection<unknown> | undefined): string | undefined {
  const pageInfo = connection?.pageInfo;
  if (!pageInfo?.hasNextPage) return undefined;
  return pageInfo.endCursor ?? undefined;
}

async function fetchRemainingComments(
  client: LinearRawClient,
  issueId: string,
  cursor: string | undefined
): Promise<LinearCommentNode[]> {
  const comments: LinearCommentNode[] = [];
  let pageCursor = cursor;

  while (pageCursor) {
    const { data } = await client.client.rawRequest<
      { issue: { comments: LinearConnection<LinearCommentNode> } | null },
      { issueId: string; cursor: string }
    >(ISSUE_COMMENTS_QUERY, { issueId, cursor: pageCursor });

    const page = data?.issue?.comments;
    comments.push(...(page?.nodes ?? []));
    pageCursor = nextCursor(page);
  }

  return comments;
}

async function fetchRemainingHistory(
  client: LinearRawClient,
  issueId: string,
  cursor: string | undefined
): Promise<LinearHistoryNode[]> {
  const history: LinearHistoryNode[] = [];
  let pageCursor = cursor;

  while (pageCursor) {
    const { data } = await client.client.rawRequest<
      { issue: { history: LinearConnection<LinearHistoryNode> } | null },
      { issueId: string; cursor: string }
    >(ISSUE_HISTORY_QUERY, { issueId, cursor: pageCursor });

    const page = data?.issue?.history;
    history.push(...(page?.nodes ?? []));
    pageCursor = nextCursor(page);
  }

  return history;
}

async function hydrateIssueActivity(
  client: LinearRawClient,
  issue: LinearIssueNode
): Promise<LinearIssueNode> {
  const commentsCursor = nextCursor(issue.comments);
  const historyCursor = nextCursor(issue.history);

  if (!commentsCursor && !historyCursor) return issue;

  const [additionalComments, additionalHistory] = await Promise.all([
    fetchRemainingComments(client, issue.id, commentsCursor),
    fetchRemainingHistory(client, issue.id, historyCursor),
  ]);

  return {
    ...issue,
    comments: {
      ...issue.comments,
      nodes: [...(issue.comments?.nodes ?? []), ...additionalComments],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    history: {
      ...issue.history,
      nodes: [...(issue.history?.nodes ?? []), ...additionalHistory],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

async function hydrateIssuesActivity(
  client: LinearRawClient,
  issues: LinearIssueNode[]
): Promise<LinearIssueNode[]> {
  return Promise.all(
    issues.map(async (issue) => {
      try {
        return await hydrateIssueActivity(client, issue);
      } catch (error) {
        log.warn('[Linear] failed to hydrate issue activity:', {
          issueId: issue.id,
          identifier: issue.identifier,
          error,
        });
        return issue;
      }
    })
  );
}

function toIssue(raw: LinearIssueNode): Issue {
  return {
    provider: 'linear',
    identifier: raw.identifier,
    title: raw.title,
    url: raw.url ?? '',
    description: raw.description ?? undefined,
    context: formatLinearContext(raw),
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
    const issues = await hydrateIssuesActivity(client, data?.issues?.nodes ?? []);

    return {
      success: true,
      issues: issues.map(toIssue),
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
    const issues = await hydrateIssuesActivity(client, data?.searchIssues?.nodes ?? []);

    return {
      success: true,
      issues: issues.map(toIssue),
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
