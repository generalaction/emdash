import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '../projects/project-provider';
import { executeTeardown } from './task-session-manager';

const teardown = vi.fn();

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    teardown: (...args: unknown[]) => teardown(...args),
  },
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
    expect(teardown).toHaveBeenCalledWith('workspace-1', 'detach');
  });

  it('terminate reaps tmux + agent and destroys the workspace', async () => {
    const { task, conversations, terminals } = makeTask();
    await executeTeardown(task, 'workspace-1', 'terminate');

    expect(conversations.destroyAll).toHaveBeenCalledTimes(1);
    expect(terminals.destroyAll).toHaveBeenCalledTimes(1);
    expect(conversations.detachAll).not.toHaveBeenCalled();
    expect(terminals.detachAll).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledWith('workspace-1', 'terminate');
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
    expect(teardown).toHaveBeenCalledWith('workspace-1', 'detach');
  });
});
