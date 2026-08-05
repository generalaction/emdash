import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostDeleteConversationOperation } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import { hostRemoveWorktreeOperation } from '@core/features/workspaces/api/node/host-outbox-operations';
import { workspaceRegistryTable as workspaces } from '@core/features/workspaces/api/node/registry';
import type { OperationSubmitter } from '@core/services/operations/api/node';
import { enqueueDeleteWorkspace } from './workspace-removal';

/**
 * Workspace removal's conversation coupling (spec §7.1): the default is archive semantics —
 * records survive with dangling paths and stay resumable if the path is recreated. The
 * opt-in enqueues explicit per-record delete requests; the `removeWorktree` verb itself
 * never touches conversation records.
 */
describe('enqueueDeleteWorkspace conversation option', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  async function seedWorktree(): Promise<void> {
    await fixture.db.insert(workspaces).values({
      id: 'repo-root',
      type: 'local',
      kind: 'repository',
      location: 'local',
      path: '/repo',
    });
    await fixture.db.insert(workspaces).values({
      id: 'workspace-1',
      type: 'local',
      kind: 'worktree',
      location: 'local',
      path: '/repo/.worktrees/example',
      parentId: 'repo-root',
    });
  }

  function seedConversationAtPath(id: string, workspacePath: string): void {
    createConversationRegistry(fixture.db).adopt({
      id,
      title: `Conversation ${id}`,
      provider: 'claude',
      type: 'acp',
      location: 'local',
      workspacePath,
      lastObservedAt: '2026-01-01T00:00:00.000Z',
      observedStatus: 'present',
    });
  }

  function submitter(): OperationSubmitter & { submit: ReturnType<typeof vi.fn> } {
    return { db: fixture.db, submit: vi.fn(async () => ok({ operationId: 'op-1' })) };
  }

  it('keeps conversation records by default — archive semantics', async () => {
    await seedWorktree();
    seedConversationAtPath('conv-keep', '/repo/.worktrees/example');
    const operations = submitter();

    const result = await enqueueDeleteWorkspace(operations, 'workspace-1');

    expect(result.success).toBe(true);
    expect(
      operations.submit.mock.calls.filter(
        ([definition]) => definition === hostDeleteConversationOperation
      )
    ).toHaveLength(0);
    // The record survives with a dangling path — resumable if the path is recreated.
    expect(createConversationRegistry(fixture.db).getLive('conv-keep')).toMatchObject({
      workspacePath: '/repo/.worktrees/example',
    });
  });

  it('opt-in enqueues explicit per-record deletes for same-path, same-host records', async () => {
    await seedWorktree();
    seedConversationAtPath('conv-here', '/repo/.worktrees/example');
    seedConversationAtPath('conv-elsewhere', '/repo/.worktrees/other');
    const operations = submitter();

    const result = await enqueueDeleteWorkspace(operations, 'workspace-1', {
      deleteConversations: true,
    });

    expect(result.success).toBe(true);
    const conversationSubmits = operations.submit.mock.calls.filter(
      ([definition]) => definition === hostDeleteConversationOperation
    );
    expect(conversationSubmits).toHaveLength(1);
    expect(conversationSubmits[0]![1]).toMatchObject({
      conversationId: 'conv-here',
      hostRef: 'local:local',
    });
    const registry = createConversationRegistry(fixture.db);
    expect(registry.getLive('conv-here')).toBeUndefined();
    expect(registry.getLive('conv-elsewhere')).toBeDefined();
  });

  it('reverts conversation tombstones when the removal enqueue is refused', async () => {
    await seedWorktree();
    seedConversationAtPath('conv-revert', '/repo/.worktrees/example');
    const operations = {
      db: fixture.db,
      submit: vi.fn(async (definition: unknown) => {
        if (definition === hostRemoveWorktreeOperation) {
          return { success: false as const, error: { type: 'operation-conflict', message: 'no' } };
        }
        return ok({ operationId: 'op-x' });
      }),
    };

    const result = await enqueueDeleteWorkspace(operations, 'workspace-1', {
      deleteConversations: true,
    });

    expect(result.success).toBe(false);
    expect(createConversationRegistry(fixture.db).getLive('conv-revert')).toBeDefined();
  });
});
