import { openFixture } from '@tooling/utils/db';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppNotification } from '../api';
import { SqliteNotificationStore } from './sqlite-store';

const notification: AppNotification = {
  id: 'n-1',
  kind: 'agent-attention',
  groupKey: 'conversation:conv-1',
  title: 'Codex - Task',
  body: 'Your agent is waiting for input',
  target: { kind: 'task', projectId: 'project-1', taskId: 'task-1', conversationId: 'conv-1' },
  source: {
    kind: 'conversation',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conv-1',
  },
  sound: 'needs_attention',
  count: 1,
  createdAt: 1_000,
  readAt: null,
};

describe('SqliteNotificationStore', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  afterEach(() => {
    fixture?.close();
  });

  it('round-trips notifications and read state', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);

    expect(await store.insert(notification)).toEqual({ success: true, data: undefined });
    expect(await store.loadRecent({ since: 0, maxRows: 10 })).toEqual([notification]);

    expect(await store.markRead(['n-1'], 2_000)).toEqual({ success: true, data: undefined });
    expect(await store.loadRecent({ since: 0, maxRows: 10 })).toEqual([
      { ...notification, readAt: 2_000 },
    ]);

    expect(await store.remove(['n-1'])).toEqual({ success: true, data: undefined });
    expect(await store.loadRecent({ since: 0, maxRows: 10 })).toEqual([]);
  });

  it('prunes notifications past the retention window and beyond the newest maxRows', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);
    for (const [id, createdAt] of [
      ['n-1', 1_000],
      ['n-2', 2_000],
      ['n-5', 5_000],
      ['n-3', 3_000],
      ['n-4', 4_000],
    ] as const) {
      await store.insert({ ...notification, id, createdAt });
    }

    expect(await store.prune({ olderThan: 2_000, maxRows: 2 })).toEqual({
      success: true,
      data: undefined,
    });
    expect(storedIds()).toEqual(['n-4', 'n-5']);
  });

  it('breaks createdAt ties by insertion order when capping rows', async () => {
    fixture = await openFixture('empty');
    const store = new SqliteNotificationStore(fixture.db);
    for (const id of ['n-c', 'n-a', 'n-b']) {
      await store.insert({ ...notification, id, createdAt: 1_000 });
    }

    expect((await store.prune({ olderThan: 0, maxRows: 2 })).success).toBe(true);
    expect(storedIds()).toEqual(['n-a', 'n-b']);
    expect((await store.loadRecent({ since: 0, maxRows: 2 })).map((row) => row.id)).toEqual([
      'n-a',
      'n-b',
    ]);
  });

  function storedIds(): string[] {
    return fixture.sqlite
      .prepare('SELECT id FROM notifications ORDER BY id')
      .pluck()
      .all() as string[];
  }
});
