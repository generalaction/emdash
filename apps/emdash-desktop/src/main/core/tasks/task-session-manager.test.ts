import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '../projects/project-provider';
import { executeTeardown, taskSessionManager } from './task-session-manager';

const mocks = vi.hoisted(() => ({
  clearTaskResourceTeardown: vi.fn(),
  persistTaskResourceTeardown: vi.fn(),
  teardown: vi.fn(),
}));

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    teardown: (...args: unknown[]) => mocks.teardown(...args),
  },
}));

vi.mock('@main/core/tasks/task-resource-teardown-state', () => ({
  clearTaskResourceTeardown: mocks.clearTaskResourceTeardown,
}));

vi.mock('./operations/persistTaskResourceTeardown', () => ({
  persistTaskResourceTeardown: mocks.persistTaskResourceTeardown,
}));

// session-targets pulls in the real DB client; it is only used by the fallback path,
// not by executeTeardown, so a stub keeps this unit test free of a SQLite import.
vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIds: vi.fn(),
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

  it('archive reaps tmux + agent and selects the non-destructive lifecycle hook', async () => {
    const { task, conversations, terminals } = makeTask();
    await executeTeardown(task, 'workspace-1', 'archive');

    expect(conversations.destroyAll).toHaveBeenCalledTimes(1);
    expect(terminals.destroyAll).toHaveBeenCalledTimes(1);
    expect(conversations.detachAll).not.toHaveBeenCalled();
    expect(terminals.detachAll).not.toHaveBeenCalled();
    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'archive');
  });

  it('clears completed teardown state when a task is registered again', async () => {
    const { task } = makeTask();

    await taskSessionManager.registerTask(
      'task-reactivated',
      { taskProvider: task, workspaceId: 'workspace-1', path: '/tmp/worktree' },
      'project-1',
      {} as never
    );

    expect(mocks.clearTaskResourceTeardown).toHaveBeenCalledWith('task-reactivated');
    await taskSessionManager.teardownTask('task-reactivated', 'detach');
  });

  it('persists lifecycle completion when project shutdown terminates retained tasks', async () => {
    const { task } = makeTask();
    mocks.persistTaskResourceTeardown.mockResolvedValue(undefined);

    await taskSessionManager.registerTask(
      'task-shutdown',
      { taskProvider: task, workspaceId: 'workspace-1', path: '/tmp/worktree' },
      'project-shutdown',
      {} as never
    );
    await taskSessionManager.teardownAllForProject('project-shutdown', 'terminate');

    expect(mocks.teardown).toHaveBeenCalledWith('workspace-1', 'terminate');
    expect(mocks.persistTaskResourceTeardown).toHaveBeenCalledWith('task-shutdown');
    expect(mocks.teardown.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.persistTaskResourceTeardown.mock.invocationCallOrder[0]
    );
  });
});
