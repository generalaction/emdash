import type { GitHeadModel, GitStatusData, GitStatusModel } from '@emdash/core/git';
import { err } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gitWorktreeUpdateChannel, type GitWorktreeUpdateEvent } from '@shared/core/git/events';
import { GitWorktreeStore } from './git-worktree-store';

const mocks = vi.hoisted(() => ({
  getWorktreeSnapshot: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      gitWorktree: {
        getWorktreeSnapshot: mocks.getWorktreeSnapshot,
      },
    },
    gitRepository: {
      fetch: vi.fn(),
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

function status(stagedPaths: string[] = []): GitStatusData {
  const staged = stagedPaths.map((path) => ({
    path,
    status: 'modified' as const,
    additions: 1,
    deletions: 0,
  }));
  return {
    kind: 'ok',
    staged,
    unstaged: [],
    stagedAdded: staged.length,
    stagedDeleted: 0,
  };
}

const head: GitHeadModel = {
  kind: 'branch',
  name: 'feature/stale-staged',
  oid: '1111111111111111111111111111111111111111',
};

function snapshot(statusModel: GitStatusModel, sequence = 1, generation = 1) {
  return {
    success: true as const,
    data: {
      status: { value: statusModel, sequence, generation },
      head: { value: head, sequence, generation },
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const repositoryStore = {
  getBranchDivergence: vi.fn(),
  isBranchOnRemote: vi.fn(),
  pushRemote: { name: 'origin' },
};

describe('GitWorktreeStore', () => {
  let worktreeHandlers: Array<(event: GitWorktreeUpdateEvent) => void>;

  beforeEach(() => {
    worktreeHandlers = [];
    mocks.getWorktreeSnapshot.mockReset();
    mocks.eventOn.mockReset();
    repositoryStore.getBranchDivergence.mockReset();
    repositoryStore.isBranchOnRemote.mockReset();
    mocks.eventOn.mockImplementation((channel, handler) => {
      if (channel === gitWorktreeUpdateChannel) worktreeHandlers.push(handler);
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function createStore(): GitWorktreeStore {
    return new GitWorktreeStore('project-1', 'workspace-1', repositoryStore as never);
  }

  it('hydrates from the worktree snapshot and applies pushed status updates', async () => {
    mocks.getWorktreeSnapshot.mockResolvedValue(snapshot(status(['src/a.ts'])));

    const store = createStore();
    store.start();

    await vi.waitFor(() =>
      expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts'])
    );

    for (const handler of worktreeHandlers) {
      handler({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        update: { kind: 'status', model: status(), sequence: 2, generation: 1 },
      });
    }

    expect(store.stagedFileChanges).toEqual([]);
    store.dispose();
  });

  it('ignores pushed updates for another workspace', async () => {
    mocks.getWorktreeSnapshot.mockResolvedValue(snapshot(status(['src/a.ts'])));

    const store = createStore();
    store.start();

    await vi.waitFor(() =>
      expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts'])
    );

    for (const handler of worktreeHandlers) {
      handler({
        projectId: 'project-1',
        workspaceId: 'workspace-other',
        update: { kind: 'status', model: status(), sequence: 2, generation: 1 },
      });
    }

    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts']);
    store.dispose();
  });

  it('ignores stale status updates by sequence', async () => {
    mocks.getWorktreeSnapshot.mockResolvedValue(snapshot(status(['src/a.ts']), 3));

    const store = createStore();
    store.start();

    await vi.waitFor(() =>
      expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts'])
    );

    for (const handler of worktreeHandlers) {
      handler({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        update: { kind: 'status', model: status(), sequence: 2, generation: 1 },
      });
    }

    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts']);
    store.dispose();
  });

  it('handles expected snapshot errors through the store error state', async () => {
    vi.useFakeTimers();
    try {
      mocks.getWorktreeSnapshot.mockResolvedValue(
        err({ type: 'git_error' as const, message: 'snapshot failed' })
      );

      const store = createStore();
      store.start();

      await flush();
      expect(mocks.getWorktreeSnapshot).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.error).toBeUndefined();

      await vi.advanceTimersByTimeAsync(2_000);
      expect(store.error).toBe('snapshot failed');

      store.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts a lower sequence from a newer generation and drops stale-generation updates', async () => {
    mocks.getWorktreeSnapshot.mockResolvedValue(snapshot(status(['src/a.ts']), 10, 1));

    const store = createStore();
    store.start();

    await vi.waitFor(() =>
      expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts'])
    );

    // The producing instance restarted: sequence resets, generation advances.
    for (const handler of worktreeHandlers) {
      handler({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        update: { kind: 'status', model: status(['src/b.ts']), sequence: 1, generation: 2 },
      });
    }
    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/b.ts']);

    // A stale message from the dead instance must not regress the state.
    for (const handler of worktreeHandlers) {
      handler({
        projectId: 'project-1',
        workspaceId: 'workspace-1',
        update: { kind: 'status', model: status(['src/old.ts']), sequence: 11, generation: 1 },
      });
    }
    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/b.ts']);
    store.dispose();
  });
});
