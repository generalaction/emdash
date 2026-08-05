import { err, ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostDeleteConversationOperation } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import type { OperationSubmitter } from '@core/services/operations/api/node';
import { enqueueConversationDeletion } from './conversation-removal';

/**
 * Enqueue-side of the delete verb (spec §4.3): untrack is the tombstone, the outbox entry
 * carries a snapshot-compiled input, and a failed submit reverts the tombstone. Records
 * leave the index only through this explicit request (`conv.explicit-delete`).
 */
describe('enqueueConversationDeletion', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  function seedConversation(id: string, options: { sshConnectionId?: string } = {}): void {
    if (options.sshConnectionId) {
      fixture.sqlite
        .prepare(
          `INSERT INTO ssh_connections (id, name, host, username) VALUES (?, ?, 'example.test', 'user')`
        )
        .run(options.sshConnectionId, options.sshConnectionId);
    }
    fixture.sqlite
      .prepare(`INSERT INTO projects (id, name) VALUES (?, ?)`)
      .run(`project-${id}`, `project-${id}`);
    fixture.sqlite
      .prepare(`INSERT INTO tasks (id, project_id, name, status) VALUES (?, ?, ?, 'running')`)
      .run(`task-${id}`, `project-${id}`, `task-${id}`);
    createConversationRegistry(fixture.db).register({
      id,
      projectId: `project-${id}`,
      taskId: `task-${id}`,
      title: `Conversation ${id}`,
      provider: 'claude',
      type: 'acp',
      location: options.sshConnectionId ? 'remote' : 'local',
      sshConnectionId: options.sshConnectionId ?? null,
      isInitialConversation: true,
    });
  }

  function submitter(submit: OperationSubmitter['submit']): OperationSubmitter {
    return { db: fixture.db, submit };
  }

  it('untracks the row and submits a snapshot-compiled delete verb', async () => {
    seedConversation('conv-1', { sshConnectionId: 'conn-1' });
    const submit = vi.fn(async () => ok({ operationId: 'op-1' }));

    const result = await enqueueConversationDeletion(submitter(submit), 'conv-1');

    expect(result.success).toBe(true);
    expect(submit).toHaveBeenCalledWith(
      hostDeleteConversationOperation,
      expect.objectContaining({
        version: '1',
        source: 'user',
        conversationId: 'conv-1',
        hostRef: 'remote:conn-1',
        projectId: 'project-conv-1',
        taskId: 'task-conv-1',
        entityName: 'Conversation conv-1',
        hostOperationId: expect.any(String),
      })
    );
    // Tombstoned: gone from live reads while the outbox entry is pending.
    expect(createConversationRegistry(fixture.db).getLive('conv-1')).toBeUndefined();
  });

  it('reverts the tombstone when the submit is refused', async () => {
    seedConversation('conv-2');
    const submit = vi.fn(async () =>
      err({ type: 'operation-conflict', message: 'conflicting operation' })
    );

    const result = await enqueueConversationDeletion(submitter(submit), 'conv-2');

    expect(result.success).toBe(false);
    expect(createConversationRegistry(fixture.db).getLive('conv-2')).toBeDefined();
  });

  it('reports not-found for absent or already-pending conversations', async () => {
    const submit = vi.fn();
    const missing = await enqueueConversationDeletion(submitter(submit), 'conv-absent');
    expect(missing).toEqual(
      err({
        type: 'conversation-not-found',
        message: 'Conversation conv-absent was not found',
      })
    );

    seedConversation('conv-3');
    createConversationRegistry(fixture.db).untrack(['conv-3'], '2026-01-01T00:00:00.000Z');
    const pending = await enqueueConversationDeletion(submitter(submit), 'conv-3');
    expect(pending.success).toBe(false);
    expect(submit).not.toHaveBeenCalled();
  });
});
