import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '@main/core/execution-context/types';
import type { TaskProvider } from '../projects/project-provider';
import { executeTeardown, taskSessionManager } from './task-session-manager';

const mocks = vi.hoisted(() => ({
  getTaskSessionLeafIds: vi.fn(),
  teardown: vi.fn(),
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    teardown: (...args: unknown[]) => mocks.teardown(...args),
  },
}));

// session-targets pulls in the real DB client; it is only used by the fallback path,
// not by executeTeardown, so a stub keeps this unit test free of a SQLite import.
vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIds: mocks.getTaskSessionLeafIds,
}));

function makeTask() {
  const conversations = { detachAll: vi.fn(), destroyAll: vi.fn() };
  const terminals = { detachAll: vi.fn(), destroyAll: vi.fn() };
  const task = { conversations, terminals } as unknown as TaskProvider;
  return { task, conversations, terminals };
}

describe('executeTeardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTaskSessionLeafIds.mockResolvedValue({ conversationIds: [], terminalIds: [] });
  });

  it('detach keeps tmux + agent running and keeps the workspace', async () => {
    const { task, conversations, terminals } = makeTask();
    await executeTeardown(task, 'workspace-1', 'detach');

    expect(conversations.detachAll).toHaveBeenCalledTimes(1);
    expect(terminals.detachAll).toHaveBeenCalledTimes(1);
    expect(conversations.destroyAll).not.toHaveBeenCalled();
    expect(terminals.destroyAll).not.toHaveBeenCalled();
    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'detach');
  });

  it('terminate reaps tmux + agent and destroys the workspace', async () => {
    const { task, conversations, terminals } = makeTask();
    await executeTeardown(task, 'workspace-1', 'terminate');

    expect(conversations.destroyAll).toHaveBeenCalledTimes(1);
    expect(terminals.destroyAll).toHaveBeenCalledTimes(1);
    expect(conversations.detachAll).not.toHaveBeenCalled();
    expect(terminals.detachAll).not.toHaveBeenCalled();
    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'terminate');
  });

  // The regression for #2689: archive must reap the tmux session + agent process
  // (destroyAll), but keep the workspace/worktree (detach-level teardown) so Restore works.
  it('archive reaps tmux + agent but keeps the workspace', async () => {
    const { task, conversations, terminals } = makeTask();
    await executeTeardown(task, 'workspace-1', 'archive');

    expect(conversations.destroyAll).toHaveBeenCalledTimes(1);
    expect(terminals.destroyAll).toHaveBeenCalledTimes(1);
    expect(conversations.detachAll).not.toHaveBeenCalled();
    expect(terminals.detachAll).not.toHaveBeenCalled();
    // crucially NOT 'terminate', which would run onDestroy and remove the worktree.
    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'detach');
  });

  it('keeps a failed teardown registered so cleanup can be retried', async () => {
    const { task, conversations } = makeTask();
    conversations.destroyAll
      .mockRejectedValueOnce(new Error('Failed to discover tmux sessions'))
      .mockResolvedValueOnce(undefined);
    const ctx = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn(),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IExecutionContext;
    const tornDown = vi.fn();
    const removeHook = taskSessionManager.hooks.on('task:torn-down', tornDown);

    try {
      await taskSessionManager.registerTask(
        'retryable-task',
        {
          path: '/repo',
          workspaceId: 'workspace-retry',
          taskProvider: task,
        },
        'project-retry',
        ctx
      );

      const failed = await taskSessionManager.teardownTask('retryable-task', 'terminate');
      expect(failed).toEqual({
        success: false,
        error: { type: 'error', message: 'Failed to discover tmux sessions' },
      });
      expect(taskSessionManager.getTask('retryable-task')).toBe(task);
      expect(tornDown).not.toHaveBeenCalled();

      await expect(taskSessionManager.teardownTask('retryable-task', 'terminate')).resolves.toEqual(
        { success: true, data: undefined }
      );
      expect(taskSessionManager.getTask('retryable-task')).toBeUndefined();
      expect(tornDown).toHaveBeenCalledTimes(1);
    } finally {
      removeHook();
    }
  });

  it('does not retain failed providers during project shutdown', async () => {
    const { task, conversations } = makeTask();
    conversations.destroyAll.mockRejectedValue(new Error('Failed to discover tmux sessions'));
    const ctx = {
      root: undefined,
      supportsLocalSpawn: false,
      exec: vi.fn(),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    } as unknown as IExecutionContext;
    const tornDown = vi.fn();
    const removeHook = taskSessionManager.hooks.on('task:torn-down', tornDown);

    try {
      await taskSessionManager.registerTask(
        'shutdown-task',
        {
          path: '/repo',
          workspaceId: 'workspace-shutdown',
          taskProvider: task,
        },
        'project-shutdown',
        ctx
      );

      await taskSessionManager.teardownAllForProject('project-shutdown', 'terminate');

      expect(taskSessionManager.getTask('shutdown-task')).toBeUndefined();
      expect(tornDown).toHaveBeenCalledTimes(1);
    } finally {
      removeHook();
    }
  });
});
