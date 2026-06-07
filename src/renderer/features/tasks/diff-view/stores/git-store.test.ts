import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsWatchEventChannel } from '@shared/core/fs/fsEvents';
import { localRef, type FullGitStatus } from '@shared/core/git/git';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/core/git/gitEvents';
import type { Result } from '@shared/lib/result';
import { GitStore } from './git-store';

const mocks = vi.hoisted(() => ({
  getFullStatus: vi.fn(),
  watchSetPaths: vi.fn(),
  watchStop: vi.fn(),
  eventOn: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      git: {
        getFullStatus: mocks.getFullStatus,
      },
      fs: {
        watchSetPaths: mocks.watchSetPaths,
        watchStop: mocks.watchStop,
      },
    },
  },
  events: {
    on: mocks.eventOn,
  },
}));

type GitFullStatusResult = Result<
  FullGitStatus,
  { type: 'too_many_files' } | { type: 'git_error'; message: string }
>;

function status({
  staged = [],
  unstaged = [],
  currentBranch = 'feature/stale-staged',
}: Partial<FullGitStatus> = {}): FullGitStatus {
  return {
    staged,
    unstaged,
    currentBranch,
    headKind: 'branch',
    shortHash: null,
    totalAdded: staged.reduce((sum, change) => sum + change.additions, 0),
    totalDeleted: staged.reduce((sum, change) => sum + change.deletions, 0),
  };
}

function okStatus(data: FullGitStatus): GitFullStatusResult {
  return { success: true, data };
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const repositoryStore = {
  getBranchDivergence: vi.fn(),
  isBranchOnRemote: vi.fn(),
  refreshLocal: vi.fn(),
  refreshRemote: vi.fn(),
  pushRemote: { name: 'origin' },
};

describe('GitStore', () => {
  let gitRefHandlers: Array<Parameters<typeof mocks.eventOn>[1]>;
  let workspaceHandlers: Array<Parameters<typeof mocks.eventOn>[1]>;
  let fsHandlers: Array<Parameters<typeof mocks.eventOn>[1]>;

  beforeEach(() => {
    vi.useFakeTimers();
    gitRefHandlers = [];
    workspaceHandlers = [];
    fsHandlers = [];
    mocks.getFullStatus.mockReset();
    mocks.watchSetPaths.mockReset();
    mocks.watchStop.mockReset();
    mocks.eventOn.mockReset();
    repositoryStore.getBranchDivergence.mockReset();
    repositoryStore.isBranchOnRemote.mockReset();
    repositoryStore.refreshLocal.mockReset();
    repositoryStore.refreshRemote.mockReset();
    mocks.watchSetPaths.mockResolvedValue({ success: true, data: {} });
    mocks.watchStop.mockResolvedValue({ success: true, data: {} });
    mocks.eventOn.mockImplementation((channel, handler) => {
      if (channel === gitRefChangedChannel) gitRefHandlers.push(handler);
      if (channel === gitWorkspaceChangedChannel) workspaceHandlers.push(handler);
      if (channel === fsWatchEventChannel) fsHandlers.push(handler);
      return vi.fn();
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function createStore(): GitStore {
    return new GitStore('project-1', 'workspace-1', repositoryStore as never);
  }

  it('refreshes staged files when an external commit advances the workspace branch ref', async () => {
    mocks.getFullStatus
      .mockResolvedValueOnce(
        okStatus(
          status({
            staged: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }],
          })
        )
      )
      .mockResolvedValue(okStatus(status()));

    const store = createStore();
    store.startWatching();
    await flushAsyncWork();

    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts']);

    for (const handler of gitRefHandlers) {
      handler({
        projectId: 'project-1',
        kind: 'local-refs',
        changedRefs: [localRef('feature/stale-staged')],
      });
    }
    vi.advanceTimersByTime(500);
    await flushAsyncWork();

    expect(mocks.getFullStatus).toHaveBeenCalledTimes(2);
    expect(store.stagedFileChanges).toEqual([]);
    store.dispose();
  });

  it('ignores project local-ref changes for a different branch', async () => {
    mocks.getFullStatus.mockResolvedValue(
      okStatus(
        status({
          staged: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }],
        })
      )
    );

    const store = createStore();
    store.startWatching();
    await flushAsyncWork();

    for (const handler of gitRefHandlers) {
      handler({
        projectId: 'project-1',
        kind: 'local-refs',
        changedRefs: [localRef('other-branch')],
      });
    }
    vi.advanceTimersByTime(500);
    await flushAsyncWork();

    expect(mocks.getFullStatus).toHaveBeenCalledTimes(1);
    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts']);
    store.dispose();
  });

  it('refreshes when a local-ref change does not identify changed refs', async () => {
    mocks.getFullStatus
      .mockResolvedValueOnce(
        okStatus(
          status({
            staged: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }],
          })
        )
      )
      .mockResolvedValue(okStatus(status()));

    const store = createStore();
    store.startWatching();
    await flushAsyncWork();

    for (const handler of gitRefHandlers) {
      handler({
        projectId: 'project-1',
        kind: 'local-refs',
      });
    }
    vi.advanceTimersByTime(500);
    await flushAsyncWork();

    expect(mocks.getFullStatus).toHaveBeenCalledTimes(2);
    expect(store.stagedFileChanges).toEqual([]);
    store.dispose();
  });

  it('ignores local-ref changes scoped to a different workspace', async () => {
    mocks.getFullStatus.mockResolvedValue(
      okStatus(
        status({
          staged: [{ path: 'src/a.ts', status: 'modified', additions: 1, deletions: 0 }],
        })
      )
    );

    const store = createStore();
    store.startWatching();
    await flushAsyncWork();

    for (const handler of gitRefHandlers) {
      handler({
        projectId: 'project-1',
        workspaceId: 'workspace-other',
        kind: 'local-refs',
        changedRefs: [localRef('feature/stale-staged')],
      });
    }
    vi.advanceTimersByTime(500);
    await flushAsyncWork();

    expect(mocks.getFullStatus).toHaveBeenCalledTimes(1);
    expect(store.stagedFileChanges.map((change) => change.path)).toEqual(['src/a.ts']);
    store.dispose();
  });
});
