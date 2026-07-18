import type { HostFileRef } from '@emdash/core/primitives/path/api';
import type * as WireModule from '@emdash/wire';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskProvider } from '../projects/project-provider';
import { executeTeardown } from './task-session-manager';

const teardown = vi.fn();
const deactivateStart = vi.fn();
const deactivateRelease = vi.fn();
const deactivateDispose = vi.fn();

vi.mock('@emdash/wire', async (importOriginal) => {
  const actual = await importOriginal<typeof WireModule>();
  return {
    ...actual,
    createLiveJobReplica: () => ({
      start: (...args: unknown[]) => deactivateStart(...args),
      dispose: () => deactivateDispose(),
    }),
  };
});

vi.mock('@main/core/workspaces/workspace-registry', () => ({
  workspaceRegistry: {
    teardown: (...args: unknown[]) => teardown(...args),
  },
}));

vi.mock('@main/gateway/accessors', () => ({
  getWorkspaceRuntimeClient: vi.fn(async () => ({ deactivate: {} })),
}));

// session-targets pulls in the real DB client; it is only used by the fallback path,
// not by executeTeardown, so a stub keeps this unit test free of a SQLite import.
vi.mock('@main/core/tasks/session-targets', () => ({
  getTaskSessionLeafIds: vi.fn(),
}));

function makeTask() {
  const conversations = { detachAll: vi.fn(), destroyAll: vi.fn() };
  const task = { taskId: 'task-1', conversations } as unknown as TaskProvider;
  return { task, conversations };
}

describe('executeTeardown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deactivateStart.mockResolvedValue({
      ready: async () => ({ result: Promise.resolve() }),
      release: deactivateRelease,
    });
  });

  it('detach keeps tmux + agent running and keeps the workspace', async () => {
    const { task, conversations } = makeTask();
    await executeTeardown(task, 'workspace-1', 'detach');

    expect(conversations.detachAll).toHaveBeenCalledTimes(1);
    expect(conversations.destroyAll).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledWith('workspace-1', 'detach');
  });

  it('terminate reaps tmux + agent and destroys the workspace', async () => {
    const { task, conversations } = makeTask();
    await executeTeardown(task, 'workspace-1', 'terminate');

    expect(conversations.destroyAll).toHaveBeenCalledTimes(1);
    expect(conversations.detachAll).not.toHaveBeenCalled();
    expect(teardown).toHaveBeenCalledWith('workspace-1', 'terminate');
  });

  // The regression for #2689: archive must reap the agent process (destroyAll),
  // but keep the workspace/worktree (detach-level teardown) so Restore works.
  it('archive reaps agent but keeps the workspace', async () => {
    const { task, conversations } = makeTask();
    await executeTeardown(task, 'workspace-1', 'archive');

    expect(conversations.destroyAll).toHaveBeenCalledTimes(1);
    expect(conversations.detachAll).not.toHaveBeenCalled();
    // crucially NOT 'terminate', which would run onDestroy and remove the worktree.
    expect(teardown).toHaveBeenCalledWith('workspace-1', 'detach');
  });

  it('passes resolved automation to workspace runtime on stop', async () => {
    const { task } = makeTask();
    const workspace: HostFileRef = {
      host: { type: 'local', id: 'local' },
      path: { root: { kind: 'posix' }, segments: ['repo', 'task'] },
    };
    const automation = {
      teardown: 'pnpm run teardown',
      shellSetup: 'source .envrc',
      autoRunSetup: true,
      autoRunRun: false,
    };

    await executeTeardown(task, 'workspace-1', 'terminate', workspace, automation);

    expect(deactivateStart).toHaveBeenCalledWith({
      workspace,
      consumerId: 'task-1',
      strategy: 'stop',
      automation,
    });
    expect(deactivateRelease).toHaveBeenCalledTimes(1);
    expect(deactivateDispose).toHaveBeenCalledTimes(1);
  });

  it('does not run teardown automation when detaching', async () => {
    const { task } = makeTask();
    const workspace: HostFileRef = {
      host: { type: 'local', id: 'local' },
      path: { root: { kind: 'posix' }, segments: ['repo', 'task'] },
    };

    await executeTeardown(task, 'workspace-1', 'detach', workspace, {
      teardown: 'pnpm run teardown',
      autoRunSetup: true,
      autoRunRun: false,
    });

    expect(deactivateStart).toHaveBeenCalledWith({
      workspace,
      consumerId: 'task-1',
      strategy: 'detach',
      automation: undefined,
    });
  });
});
