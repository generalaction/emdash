import type { AutomationEvent } from '@shared/automations/events';
import type { GitHubIssue } from '@main/core/github/services/issue-service';
import { trackSeenIssueIds } from './cursor';
import type { PollerCursor, PollerResult } from './types';

export type ListIssuesResult = { ok: boolean; issues: GitHubIssue[] };
export type ListIssuesFn = () => Promise<ListIssuesResult>;

/**
 * On seed (no prior cursor) and on schema migration we don't emit events for the
 * full backlog, otherwise users get spammed with `issue.opened` for every existing
 * open issue. But we do emit for very-recently created ones so a user who just
 * created a test issue right around the time we seed still sees the trigger fire.
 */
const SEED_RECENT_WINDOW_MS = 10 * 60 * 1000;

function isRecentlyCreated(issue: GitHubIssue, now: number): boolean {
  if (!issue.createdAt) return false;
  const created = Date.parse(issue.createdAt);
  if (Number.isNaN(created)) return false;
  return now - created <= SEED_RECENT_WINDOW_MS;
}

function toIssueEvent(projectId: string, issue: GitHubIssue, occurredAt: number): AutomationEvent {
  return {
    kind: 'issue.opened',
    projectId,
    occurredAt,
    payload: {
      ref: `#${issue.number}`,
      title: issue.title,
      url: issue.url,
      author: issue.user?.login ?? '',
      number: String(issue.number),
      body: '',
      labels: issue.labels.map((label) => label.name).filter((name) => name.length > 0),
      assignee: issue.assignees[0]?.login ?? null,
    },
  };
}

/**
 * First call (cursor.initialized falsy) seeds the seen-url set. We emit events
 * only for issues created within SEED_RECENT_WINDOW_MS so a freshly created issue
 * still triggers automations even if we happen to seed right after it appears.
 * Later calls emit `issue.opened` for any new URL and update the seen set.
 * URLs are used as the dedup key so issues from different repos in the same project
 * (which can share #N) don't collide.
 *
 * `initialized` only flips to `true` when the fetch actually succeeded — otherwise a
 * failed first fetch (auth not ready, transient network error) would seed an empty
 * seen-set and the next successful fetch would spam `issue.opened` for every existing
 * issue.
 */
export async function diffIssuesAgainstCursor(
  projectId: string,
  cursor: PollerCursor | null,
  listIssues: ListIssuesFn
): Promise<PollerResult> {
  const { ok, issues } = await listIssues();
  const now = Date.now();
  const seenSet = new Set(cursor?.seenIssueIds ?? []);
  const events: AutomationEvent[] = [];
  const fresh: string[] = [];
  const initialized = cursor?.initialized === true;

  for (const issue of issues) {
    if (!issue.url || seenSet.has(issue.url)) continue;
    fresh.push(issue.url);
    if (initialized || isRecentlyCreated(issue, now)) {
      events.push(toIssueEvent(projectId, issue, now));
    }
  }

  return {
    events,
    cursor: {
      ...(cursor ?? {}),
      initialized: initialized || ok,
      seenIssueIds: trackSeenIssueIds(cursor?.seenIssueIds, fresh),
    },
  };
}
