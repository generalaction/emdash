import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppNotification } from '../api';
import { systemClock } from '../api/ports';
import { NotificationService } from './notification-service';
import { SqliteNotificationStore } from './sqlite-store';

const DAY_MS = 24 * 60 * 60 * 1_000;

function notificationAt(id: string, createdAt: number): AppNotification {
  return {
    id,
    kind: 'agent-attention',
    groupKey: `conversation:${id}`,
    title: 'Codex - Task',
    body: 'Your agent is waiting for input',
    target: { kind: 'task', projectId: 'project-1', taskId: 'task-1', conversationId: id },
    source: { kind: 'conversation', projectId: 'project-1', taskId: 'task-1', conversationId: id },
    sound: 'needs_attention',
    count: 1,
    createdAt,
    readAt: null,
  };
}

describe('NotificationService with SQLite storage', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;
  let service: NotificationService | undefined;

  afterEach(() => {
    service?.dispose();
    fixture?.close();
  });

  it('prunes stored notifications on initialize without logging a failure', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);
    const now = 30 * DAY_MS;
    for (const [id, createdAt] of [
      ['expired', now - 15 * DAY_MS],
      ['n-1', now - 3_000],
      ['n-2', now - 2_000],
      ['n-3', now - 1_000],
    ] as const) {
      await store.insert(notificationAt(id, createdAt));
    }
    const logger = { warn: vi.fn() };

    service = new NotificationService({
      store,
      logger,
      maxRows: 2,
      clock: { ...systemClock, now: () => now },
      routingContext: () => {
        throw new Error('initialize must not route notifications');
      },
    });
    await service.initialize();

    expect(logger.warn).not.toHaveBeenCalled();
    expect(
      fixture.sqlite.prepare('SELECT id FROM notifications ORDER BY id').pluck().all()
    ).toEqual(['n-2', 'n-3']);
    expect(Object.keys(service.snapshot())).toEqual(['n-2', 'n-3']);
  });
});
