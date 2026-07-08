import type { LinearClient } from '../../../integrations/impl/linear/types';

export type LinearIssueSummaryNode = {
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

export type LinearCommentNode = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  user: { displayName: string; name: string } | null;
};

export type LinearPageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type LinearConnection<T> = {
  nodes: T[];
  pageInfo?: LinearPageInfo;
};

export type LinearHistoryNode = {
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

export type LinearIssueActivity = {
  id: string;
  comments: LinearConnection<LinearCommentNode>;
  history: LinearConnection<LinearHistoryNode>;
};

export type LinearIssueWithActivity = LinearIssueSummaryNode & LinearIssueActivity;

const ACTIVITY_PAGE_SIZE = 50;

const ISSUE_SUMMARY_FIELDS = `
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
`;

const ISSUE_SUMMARY_FRAGMENT = `
  fragment IssueSummary on Issue {
    ${ISSUE_SUMMARY_FIELDS}
  }
`;

const ISSUE_SEARCH_SUMMARY_FRAGMENT = `
  fragment IssueSearchSummary on IssueSearchResult {
    ${ISSUE_SUMMARY_FIELDS}
  }
`;

const COMMENT_FIELDS = `
  id
  body
  createdAt
  updatedAt
  url
  user { displayName name }
`;

const HISTORY_FIELDS = `
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
`;

const ISSUE_ACTIVITY_FIELDS = `
  comments(first: ${ACTIVITY_PAGE_SIZE}, orderBy: createdAt) {
    pageInfo { hasNextPage endCursor }
    nodes { ${COMMENT_FIELDS} }
  }
  history(first: ${ACTIVITY_PAGE_SIZE}, orderBy: createdAt) {
    pageInfo { hasNextPage endCursor }
    nodes { ${HISTORY_FIELDS} }
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
  ${ISSUE_SEARCH_SUMMARY_FRAGMENT}

  query SearchIssues($term: String!, $limit: Int!) {
    searchIssues(term: $term, first: $limit) {
      nodes {
        ...IssueSearchSummary
      }
    }
  }
`;

const ISSUE_WITH_ACTIVITY_QUERY = `
  ${ISSUE_SUMMARY_FRAGMENT}

  query IssueWithActivity($id: String!) {
    issue(id: $id) {
      ...IssueSummary
      ${ISSUE_ACTIVITY_FIELDS}
    }
  }
`;

const ISSUE_COMMENTS_QUERY = `
  query IssueComments($issueId: String!, $cursor: String) {
    issue(id: $issueId) {
      comments(first: ${ACTIVITY_PAGE_SIZE}, after: $cursor, orderBy: createdAt) {
        pageInfo { hasNextPage endCursor }
        nodes { ${COMMENT_FIELDS} }
      }
    }
  }
`;

const ISSUE_HISTORY_QUERY = `
  query IssueHistory($issueId: String!, $cursor: String) {
    issue(id: $issueId) {
      history(first: ${ACTIVITY_PAGE_SIZE}, after: $cursor, orderBy: createdAt) {
        pageInfo { hasNextPage endCursor }
        nodes { ${HISTORY_FIELDS} }
      }
    }
  }
`;

export async function queryLinearIssues(
  client: LinearClient,
  limit: number
): Promise<LinearIssueSummaryNode[]> {
  const { data } = await client.client.rawRequest<
    { issues: { nodes: LinearIssueSummaryNode[] } },
    { limit: number }
  >(ISSUES_QUERY, { limit });

  return data?.issues.nodes ?? [];
}

export async function searchLinearIssues(
  client: LinearClient,
  term: string,
  limit: number
): Promise<LinearIssueSummaryNode[]> {
  const { data } = await client.client.rawRequest<
    { searchIssues: { nodes: LinearIssueSummaryNode[] } },
    { term: string; limit: number }
  >(SEARCH_QUERY, { term, limit });

  return data?.searchIssues.nodes ?? [];
}

/** Looks up a single issue by UUID or shorthand identifier (e.g. "GEN-626"). */
export async function queryLinearIssueWithActivity(
  client: LinearClient,
  identifier: string
): Promise<LinearIssueWithActivity | undefined> {
  try {
    const { data } = await client.client.rawRequest<
      { issue: LinearIssueWithActivity | null },
      { id: string }
    >(ISSUE_WITH_ACTIVITY_QUERY, { id: identifier });

    return data?.issue ?? undefined;
  } catch (error) {
    if (isEntityNotFound(error)) return undefined;
    throw error;
  }
}

export async function fetchRemainingComments(
  client: LinearClient,
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
    pageCursor = getNextCursor(page);
  }

  return comments;
}

export async function fetchRemainingHistory(
  client: LinearClient,
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
    pageCursor = getNextCursor(page);
  }

  return history;
}

export function getNextCursor(
  connection: LinearConnection<unknown> | undefined
): string | undefined {
  const pageInfo = connection?.pageInfo;
  if (!pageInfo?.hasNextPage) return undefined;
  return pageInfo.endCursor ?? undefined;
}

function isEntityNotFound(error: unknown): boolean {
  return error instanceof Error && /entity not found/i.test(error.message);
}
