import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import type { ConversationInsert } from '@core/services/app-db/node/schema';
import { listHostConversations } from './list-host-conversations';

/**
 * The machine-page read (spec §8): all cached conversation observations of one host —
 * task-linked and orphaned alike — with link names resolved, plus tombstoned rows whose
 * delete operation is still in flight shown as removal-pending.
 */
describe('listHostConversations', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  function seedProjectAndTask(suffix: string): { projectId: string; taskId: string } {
    const projectId = `project-${suffix}`;
    const taskId = `task-${suffix}`;
    fixture.sqlite
      .prepare(`INSERT INTO projects (id, name) VALUES (?, ?)`)
      .run(projectId, `Project ${suffix}`);
    fixture.sqlite
      .prepare(`INSERT INTO tasks (id, project_id, name, status) VALUES (?, ?, ?, 'running')`)
      .run(taskId, projectId, `Task ${suffix}`);
    return { projectId, taskId };
  }

  function seedConversation(id: string, overrides: Partial<ConversationInsert> = {}): void {
    createConversationRegistry(fixture.db).register({
      id,
      projectId: null,
      taskId: null,
      title: `Conversation ${id}`,
      provider: 'claude',
      type: 'acp',
      workspacePath: '/work/repo',
      location: 'local',
      sshConnectionId: null,
      ...overrides,
    });
  }

  const noActiveOperations = async () => [];

  it('lists linked and orphaned rows of the host with link names resolved', async () => {
    const { projectId, taskId } = seedProjectAndTask('a');
    seedConversation('conv-linked', { projectId, taskId });
    seedConversation('conv-orphan');
    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, username) VALUES ('conn-1', 'conn-1', 'example.test', 'user')`
      )
      .run();
    seedConversation('conv-remote', { location: 'remote', sshConnectionId: 'conn-1' });

    const rows = await listHostConversations(fixture.db, noActiveOperations, {
      location: 'local',
      sshConnectionId: null,
    });

    expect(rows.map((row) => row.id).sort((a, b) => a.localeCompare(b))).toEqual([
      'conv-linked',
      'conv-orphan',
    ]);
    const linked = rows.find((row) => row.id === 'conv-linked');
    expect(linked).toMatchObject({
      projectId,
      taskId,
      projectName: 'Project a',
      taskName: 'Task a',
      pendingRemoval: false,
    });
    const orphan = rows.find((row) => row.id === 'conv-orphan');
    expect(orphan).toMatchObject({
      projectId: null,
      taskId: null,
      projectName: null,
      taskName: null,
    });
  });

  it('scopes to the requested host', async () => {
    seedConversation('conv-local');
    fixture.sqlite
      .prepare(
        `INSERT INTO ssh_connections (id, name, host, username) VALUES ('conn-1', 'conn-1', 'example.test', 'user')`
      )
      .run();
    seedConversation('conv-remote', { location: 'remote', sshConnectionId: 'conn-1' });

    const remote = await listHostConversations(fixture.db, noActiveOperations, {
      location: 'remote',
      sshConnectionId: 'conn-1',
    });
    expect(remote.map((row) => row.id)).toEqual(['conv-remote']);
  });

  it('shows tombstoned rows as removal-pending only while their delete operation is live', async () => {
    seedConversation('conv-pending');
    seedConversation('conv-settled');
    const registry = createConversationRegistry(fixture.db);
    registry.untrack(['conv-pending', 'conv-settled'], '2026-01-01T00:00:00.000Z');

    const rows = await listHostConversations(
      fixture.db,
      async () => [{ conversationId: 'conv-pending', otherField: 'ignored' }],
      { location: 'local', sshConnectionId: null }
    );

    // The settled tombstone left the surface; the in-flight one is presented as pending.
    expect(rows.map((row) => row.id)).toEqual(['conv-pending']);
    expect(rows[0]).toMatchObject({ pendingRemoval: true });
  });
});
