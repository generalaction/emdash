import { ok } from '@emdash/shared';
import { openFixture } from '@tooling/utils/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostDeleteConversationOperation } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import { createConversationRegistry } from '@core/features/conversations/api/node/registry';
import {
  createWorkspaceRegistry,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { tasks } from '@core/services/app-db/node/schema';
import type { OperationSubmitter } from '@core/services/operations/api/node';
import { deleteWorkspaceThroughRegistry } from './workspace-removal';

/**
 * Workspace removal through the registry verbs (ADR 0005): one fail-fast host RPC,
 * then the mirror row untracks. Conversation coupling stays spec §7.1: archive
 * semantics by default, explicit per-record deletes on opt-in.
 */
describe('deleteWorkspaceThroughRegistry', () => {
  let fixture: Awaited<ReturnType<typeof openFixture>>;

  beforeEach(async () => {
    fixture = await openFixture('empty');
  });

  afterEach(() => {
    fixture.close();
  });

  async function seedWorktree(kind: 'worktree' | 'directory' = 'worktree'): Promise<void> {
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
      kind,
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

  function makeRuntimes() {
    const registry = {
      deleteWorktree: vi.fn(async (_input: { id: string; deleteBranch: boolean }) => ({
        success: true as const,
        data: undefined,
      })),
      deleteWorkspace: vi.fn(async (_input: { id: string }) => ({
        success: true as const,
        data: undefined,
      })),
    };
    const runtimes = {
      client: vi.fn(async () => ({
        success: true as const,
        data: { workspaceRegistry: registry },
      })),
    };
    return { registry, runtimes };
  }

  it('calls the deleteWorktree verb and untracks the mirror row on success', async () => {
    await seedWorktree();
    const { registry, runtimes } = makeRuntimes();
    const operations = submitter();

    const result = await deleteWorkspaceThroughRegistry(operations, runtimes, 'workspace-1', {
      deleteBranch: true,
    });

    expect(result.success).toBe(true);
    expect(registry.deleteWorktree).toHaveBeenCalledWith({
      id: 'workspace-1',
      deleteBranch: true,
    });
    expect(registry.deleteWorkspace).not.toHaveBeenCalled();
    expect(createWorkspaceRegistry(fixture.db).getLive('workspace-1')).toBeUndefined();
  });

  it('routes directory rows through the deleteWorkspace verb', async () => {
    await seedWorktree('directory');
    const { registry, runtimes } = makeRuntimes();

    const result = await deleteWorkspaceThroughRegistry(submitter(), runtimes, 'workspace-1');

    expect(result.success).toBe(true);
    expect(registry.deleteWorkspace).toHaveBeenCalledWith({ id: 'workspace-1' });
    expect(registry.deleteWorktree).not.toHaveBeenCalled();
    expect(createWorkspaceRegistry(fixture.db).getLive('workspace-1')).toBeUndefined();
  });

  it('fails fast with host-unreachable and leaves everything intact', async () => {
    await seedWorktree();
    seedConversationAtPath('conv-stay', '/repo/.worktrees/example');
    const operations = submitter();
    const runtimes = {
      client: vi.fn(async () => ({
        success: false as const,
        error: { type: 'host-unreachable' as const, message: 'ssh down' },
      })),
    };

    const result = await deleteWorkspaceThroughRegistry(operations, runtimes, 'workspace-1', {
      deleteConversations: true,
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'host-unreachable', message: 'ssh down' },
    });
    // Nothing queued, nothing untracked — the row stays registered host-side.
    expect(operations.submit).not.toHaveBeenCalled();
    expect(createWorkspaceRegistry(fixture.db).getLive('workspace-1')).toBeDefined();
    expect(createConversationRegistry(fixture.db).getLive('conv-stay')).toBeDefined();
  });

  it('surfaces a failed verb without untracking', async () => {
    await seedWorktree();
    const { registry, runtimes } = makeRuntimes();
    registry.deleteWorktree.mockResolvedValueOnce({
      success: false,
      error: { type: 'remove-failed', message: 'locked worktree' },
    } as never);

    const result = await deleteWorkspaceThroughRegistry(submitter(), runtimes, 'workspace-1');

    expect(result).toEqual({
      success: false,
      error: { type: 'delete-failed', message: 'locked worktree' },
    });
    expect(createWorkspaceRegistry(fixture.db).getLive('workspace-1')).toBeDefined();
  });

  it('refuses while a live task still references the workspace, without calling the host', async () => {
    await seedWorktree();
    fixture.sqlite.prepare(`INSERT INTO projects (id, name) VALUES ('project-1', 'Project')`).run();
    await fixture.db.insert(tasks).values({
      id: 'task-1',
      projectId: 'project-1',
      name: 'Task',
      status: 'in_progress',
      workspaceId: 'workspace-1',
    });
    const { registry, runtimes } = makeRuntimes();

    const result = await deleteWorkspaceThroughRegistry(submitter(), runtimes, 'workspace-1');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('workspace-in-use');
    expect(registry.deleteWorktree).not.toHaveBeenCalled();
    expect(createWorkspaceRegistry(fixture.db).getLive('workspace-1')).toBeDefined();
  });

  it('keeps conversation records by default — archive semantics', async () => {
    await seedWorktree();
    seedConversationAtPath('conv-keep', '/repo/.worktrees/example');
    const { runtimes } = makeRuntimes();
    const operations = submitter();

    const result = await deleteWorkspaceThroughRegistry(operations, runtimes, 'workspace-1');

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

  it('opt-in submits explicit per-record deletes for same-path, same-host records', async () => {
    await seedWorktree();
    seedConversationAtPath('conv-here', '/repo/.worktrees/example');
    seedConversationAtPath('conv-elsewhere', '/repo/.worktrees/other');
    const { runtimes } = makeRuntimes();
    const operations = submitter();

    const result = await deleteWorkspaceThroughRegistry(operations, runtimes, 'workspace-1', {
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
});
