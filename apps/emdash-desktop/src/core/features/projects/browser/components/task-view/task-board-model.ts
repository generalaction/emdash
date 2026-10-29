import type { PullRequest } from '@emdash/plugins/pull-requests/schemas';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import type { Task } from '@core/primitives/tasks/api';

export const BOARD_COLUMNS = ['Backlog', 'Running', 'Awaiting Input', 'Review', 'Done'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

type BoardConversation = Pick<ConversationStore, 'data' | 'status'>;

/** A presentation of existing facts, never a persisted task workflow. Ignore notification `seen`. */
export function taskBoardColumn(
  task: Pick<Task, 'archivedAt' | 'status'>,
  conversations: readonly BoardConversation[],
  pr?: Pick<PullRequest, 'status'>
): BoardColumn {
  if (task.archivedAt || task.status === 'done' || pr?.status === 'merged') return 'Done';
  if (conversations.some((c) => c.status === 'awaiting-input' || c.status === 'error')) {
    return 'Awaiting Input';
  }
  if (conversations.some((c) => c.status === 'working')) return 'Running';
  if (
    pr?.status === 'open' ||
    task.status === 'review' ||
    conversations.some((c) => c.status === 'completed')
  ) {
    return 'Review';
  }
  return 'Backlog';
}

/** Prefer the conversation responsible for attention/work, then the most recently used session. */
export function boardConversation(conversations: readonly BoardConversation[]) {
  const priority = (c: BoardConversation) => {
    if (c.status === 'awaiting-input' || c.status === 'error') return 0;
    if (c.status === 'working') return 1;
    if (c.status === 'completed') return 2;
    return c.data.sessionId ? 3 : 4;
  };
  return [...conversations].sort(
    (a, b) =>
      priority(a) - priority(b) ||
      (b.data.lastInteractedAt ?? '').localeCompare(a.data.lastInteractedAt ?? '') ||
      a.data.id.localeCompare(b.data.id)
  )[0];
}

/** Existing persisted activity/metadata timestamps; agent-status events carry no activity time. */
export function boardLastActivity(
  task: Pick<Task, 'createdAt' | 'updatedAt' | 'lastInteractedAt' | 'statusChangedAt'>,
  conversations: readonly BoardConversation[]
): number {
  const timestamps = [
    task.createdAt,
    task.updatedAt,
    task.lastInteractedAt,
    task.statusChangedAt,
    ...conversations.map((c) => c.data.lastInteractedAt),
  ];
  return Math.max(
    ...timestamps.flatMap((value) => {
      if (!value) return [];
      // SQLite's bare timestamps are UTC, matching RelativeTime's parsing convention.
      const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
        ? value.replace(' ', 'T') + 'Z'
        : value;
      const instant = Date.parse(normalized);
      return Number.isNaN(instant) ? [] : [instant];
    })
  );
}
