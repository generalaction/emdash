import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostDeleteConversationOperation } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import {
  createConversationRegistry,
  conversationRegistryTable as conversations,
} from '@core/features/conversations/api/node/registry';
import { deleteTaskOperation } from '@core/features/tasks/api/node/delete-task-operation';
import { tasks } from '@core/services/app-db/node/schema';
import type { OperationSubmitter } from '@core/services/operations/api/node';
import { enqueueDeleteTask } from './delete-task-definition';

/**
 * Task deletion's conversation cascade (spec §7.2): records leave the host index only by
 * explicit per-record delete requests (`conv.explicit-delete`) — the task tombstone alone
 * never deletes host records, and declining the cascade unlinks the records so they orphan
 * into the discovery surface instead of dying with the task row's FK cascade.
 */
describe('enqueueDeleteTask conversation cascade', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  function seedTaskWithConversations(taskId: string, conversationIds: string[]): void {
    fixture.sqlite
      .prepare(`INSERT INTO projects (id, name) VALUES (?, ?)`)
      .run(`project-${taskId}`, `project-${taskId}`);
    fixture.sqlite
      .prepare(`INSERT INTO tasks (id, project_id, name, status) VALUES (?, ?, ?, 'running')`)
      .run(taskId, `project-${taskId}`, `task-${taskId}`);
    const registry = createConversationRegistry(fixture.db);
    for (const id of conversationIds) {
      registry.register({
        id,
        projectId: `project-${taskId}`,
        taskId,
        title: `Conversation ${id}`,
        provider: 'claude',
        type: 'acp',
        location: 'local',
        isInitialConversation: false,
      });
    }
  }

  function submitter(): OperationSubmitter & { submit: ReturnType<typeof vi.fn> } {
    return { db: fixture.db, submit: vi.fn(async () => ok({ operationId: 'op-1' })) };
  }

  it('submits one explicit delete verb per conversation by default', async () => {
    seedTaskWithConversations('task-1', ['conv-a', 'conv-b']);
    const operations = submitter();

    const result = await enqueueDeleteTask(operations, { taskId: 'task-1' });

    expect(result.success).toBe(true);
    const conversationSubmits = operations.submit.mock.calls.filter(
      ([definition]) => definition === hostDeleteConversationOperation
    );
    expect(
      conversationSubmits
        .map(([, input]) => input.conversationId as string)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(['conv-a', 'conv-b']);
    // Snapshot-compiled inputs: identity rides the operation, not the mirror row.
    expect(conversationSubmits[0]![1]).toMatchObject({
      hostRef: 'local:local',
      taskId: 'task-1',
      projectId: 'project-task-1',
    });
    // Mirror rows tombstone with the task.
    const registry = createConversationRegistry(fixture.db);
    expect(registry.getLive('conv-a')).toBeUndefined();
    expect(registry.getLive('conv-b')).toBeUndefined();
  });

  it('declining the cascade unlinks the records instead of deleting them', async () => {
    seedTaskWithConversations('task-2', ['conv-c']);
    const operations = submitter();

    const result = await enqueueDeleteTask(operations, {
      taskId: 'task-2',
      deleteConversations: false,
    });

    expect(result.success).toBe(true);
    // No implicit deletion: the task tombstone alone never deletes host records
    // (`conv.explicit-delete`).
    expect(
      operations.submit.mock.calls.filter(
        ([definition]) => definition === hostDeleteConversationOperation
      )
    ).toHaveLength(0);
    const [row] = fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conv-c'))
      .all();
    expect(row).toMatchObject({ taskId: null, projectId: null, untrackedAt: null });
  });

  it('reverts conversation tombstones when the task enqueue is refused', async () => {
    seedTaskWithConversations('task-3', ['conv-d']);
    const operations = {
      db: fixture.db,
      submit: vi.fn(async (definition: unknown) => {
        if (definition === deleteTaskOperation) {
          return { success: false as const, error: { type: 'operation-conflict', message: 'no' } };
        }
        return ok({ operationId: 'op-x' });
      }),
    };

    const result = await enqueueDeleteTask(operations, { taskId: 'task-3' });

    expect(result.success).toBe(false);
    expect(createConversationRegistry(fixture.db).getLive('conv-d')).toBeDefined();
    const [taskRow] = fixture.db.select().from(tasks).where(eq(tasks.id, 'task-3')).all();
    expect(taskRow?.deletedAt).toBeNull();
  });

  it('restores links when a declined-cascade enqueue is refused', async () => {
    seedTaskWithConversations('task-4', ['conv-e']);
    const operations = {
      db: fixture.db,
      submit: vi.fn(async () => ({
        success: false as const,
        error: { type: 'operation-conflict', message: 'no' },
      })),
    };

    const result = await enqueueDeleteTask(operations, {
      taskId: 'task-4',
      deleteConversations: false,
    });

    expect(result.success).toBe(false);
    const [row] = fixture.db
      .select()
      .from(conversations)
      .where(eq(conversations.id, 'conv-e'))
      .all();
    expect(row).toMatchObject({ taskId: 'task-4', projectId: 'project-task-4' });
  });
});
