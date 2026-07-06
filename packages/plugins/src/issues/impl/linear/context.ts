import type { LinearClient } from '../../../integrations/impl/linear/types';
import type { LinearHistoryNode, LinearIssueActivity } from './queries';
import { fetchRemainingComments, fetchRemainingHistory, getNextCursor } from './queries';

export async function getLinearIssueDetails(
  client: LinearClient,
  issue: LinearIssueActivity
): Promise<{ context: string | undefined }> {
  let hydratedIssue = issue;
  try {
    hydratedIssue = await hydrateIssueActivity(client, issue);
  } catch {
    hydratedIssue = issue;
  }

  return { context: formatLinearContext(hydratedIssue) };
}

export async function hydrateIssueActivity<TIssue extends LinearIssueActivity>(
  client: LinearClient,
  issue: TIssue
): Promise<TIssue> {
  const commentsCursor = getNextCursor(issue.comments);
  const historyCursor = getNextCursor(issue.history);

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
