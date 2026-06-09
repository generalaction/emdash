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

type LinearIssueActivity = {
  id: string;
  comments: LinearConnection<LinearCommentNode>;
  history: LinearConnection<LinearHistoryNode>;
};

export type LinearIssueWithActivity<TIssue extends { id: string }> = TIssue & LinearIssueActivity;

type LinearRawClient = {
  client: {
    rawRequest: <TData, TVariables extends Record<string, unknown>>(
      query: string,
      variables: TVariables
    ) => Promise<{ data?: TData }>;
  };
};

const ACTIVITY_PAGE_SIZE = 50;

export const LINEAR_ISSUE_ACTIVITY_FIELDS = `
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

export function formatLinearContext(raw: LinearIssueActivity): string | undefined {
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

export async function hydrateIssueActivity<TIssue extends LinearIssueActivity>(
  client: LinearRawClient,
  issue: TIssue
): Promise<TIssue> {
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
