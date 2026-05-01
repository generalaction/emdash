import type { AutomationEvent } from '@shared/automations/events';
import type { Issue } from '@shared/tasks';
import { trackSeenIssueIds } from './cursor';
import type { PollerCursor, PollerResult } from './types';

export type ListIssuesFn = () => Promise<
  { ok: true; issues: Issue[] } | { ok: false; error: string }
>;

function toIssueEvent(projectId: string, issue: Issue, occurredAt: number): AutomationEvent {
  return {
    kind: 'issue.opened',
    projectId,
    occurredAt,
    payload: {
      ref: issue.identifier,
      title: issue.title,
      url: issue.url,
      author: '',
      number: issue.identifier,
      body: issue.description ?? '',
      labels: [],
      assignee: issue.assignees && issue.assignees.length > 0 ? issue.assignees[0] : null,
    },
  };
}

/**
 * First call (cursor.initialized falsy) seeds the seen-id set without emitting events.
 * Later calls emit `issue.opened` for any new identifier and update the seen set.
 */
export async function diffIssuesAgainstCursor(
  projectId: string,
  cursor: PollerCursor | null,
  listIssues: ListIssuesFn
): Promise<PollerResult> {
  const result = await listIssues();
  if (!result.ok) {
    return { events: [], cursor: cursor ?? { initialized: false, seenIssueIds: [] } };
  }
  const now = Date.now();
  const seenSet = new Set(cursor?.seenIssueIds ?? []);
  const events: AutomationEvent[] = [];
  const fresh: string[] = [];

  for (const issue of result.issues) {
    if (!issue.identifier || seenSet.has(issue.identifier)) continue;
    fresh.push(issue.identifier);
    if (cursor?.initialized) {
      events.push(toIssueEvent(projectId, issue, now));
    }
  }

  return {
    events,
    cursor: {
      ...(cursor ?? {}),
      initialized: true,
      seenIssueIds: trackSeenIssueIds(cursor?.seenIssueIds, fresh),
    },
  };
}
