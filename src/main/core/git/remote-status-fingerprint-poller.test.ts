import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitStatusFingerprint, GitStatusUntrackedMode } from '@shared/core/git/git';
import type { WorkspaceGitProvider } from './workspace-git-provider';

vi.mock('@main/lib/events', () => ({
  events: {
    emit: vi.fn(),
  },
}));

vi.mock('@main/core/workspaces/workspace-current-branch-cache', () => ({
  refreshWorkspaceCurrentBranchCache: vi.fn(),
}));

const { events } = await import('@main/lib/events');
const { refreshWorkspaceCurrentBranchCache } =
  await import('@main/core/workspaces/workspace-current-branch-cache');
const { RemoteStatusFingerprintPoller } = await import('./remote-status-fingerprint-poller');

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function fingerprint(hash: string): GitStatusFingerprint {
  return { hash, byteLength: hash.length };
}

function makeGitProvider(
  getStatusFingerprint: (untracked: GitStatusUntrackedMode) => Promise<GitStatusFingerprint>
): WorkspaceGitProvider {
  return {
    getStatusFingerprint,
    getCurrentBranch: vi.fn().mockResolvedValue('main'),
  } as unknown as WorkspaceGitProvider;
}

describe('RemoteStatusFingerprintPoller', () => {
  let cachedBranchName: string | null | undefined;

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(() => {
    cachedBranchName = undefined;
    vi.mocked(refreshWorkspaceCurrentBranchCache).mockImplementation(async (_workspaceId, git) => {
      const branchName = await git.getCurrentBranch();
      const changed = cachedBranchName !== branchName;
      cachedBranchName = branchName;
      return { branchName, changed };
    });
  });

  it('can restart while a stale poll is still in flight', async () => {
    const staleTracked = deferred<GitStatusFingerprint>();
    const staleUntracked = deferred<GitStatusFingerprint>();
    const calls: GitStatusUntrackedMode[] = [];

    const getStatusFingerprint = vi.fn((untracked: GitStatusUntrackedMode) => {
      calls.push(untracked);
      if (calls.length <= 2) {
        return untracked === 'no' ? staleTracked.promise : staleUntracked.promise;
      }
      return Promise.resolve(fingerprint(`fresh-${untracked}`));
    });

    const poller = new RemoteStatusFingerprintPoller(
      'project-id',
      'workspace-id',
      makeGitProvider(getStatusFingerprint)
    );

    poller.start();
    poller.stop();
    poller.start();
    await vi.waitFor(() => expect(events.emit).toHaveBeenCalledTimes(1));

    expect(calls).toEqual(['no', 'normal', 'no', 'normal']);

    staleTracked.resolve(fingerprint('stale-no'));
    staleUntracked.resolve(fingerprint('stale-normal'));
    await Promise.all([staleTracked.promise, staleUntracked.promise]);

    expect(events.emit).toHaveBeenCalledTimes(1);
    poller.stop();
  });

  it('loads tracked and untracked fingerprints concurrently during initialization', async () => {
    const tracked = deferred<GitStatusFingerprint>();
    const untracked = deferred<GitStatusFingerprint>();
    const calls: GitStatusUntrackedMode[] = [];

    const poller = new RemoteStatusFingerprintPoller(
      'project-id',
      'workspace-id',
      makeGitProvider((mode) => {
        calls.push(mode);
        return mode === 'no' ? tracked.promise : untracked.promise;
      })
    );

    poller.start();

    expect(calls).toEqual(['no', 'normal']);
    expect(events.emit).not.toHaveBeenCalled();

    tracked.resolve(fingerprint('tracked'));
    await Promise.resolve();
    expect(events.emit).not.toHaveBeenCalled();

    untracked.resolve(fingerprint('untracked'));
    await vi.waitFor(() => expect(events.emit).toHaveBeenCalledTimes(1));

    poller.stop();
  });

  it('emits a head event when the branch cache changes without status changes', async () => {
    let branchName = 'main';
    const git = makeGitProvider(() => Promise.resolve(fingerprint('unchanged')));
    vi.mocked(git.getCurrentBranch).mockImplementation(() => Promise.resolve(branchName));

    const poller = new RemoteStatusFingerprintPoller('project-id', 'workspace-id', git);

    poller.start();
    await vi.waitFor(() => expect(events.emit).toHaveBeenCalledTimes(1));
    vi.clearAllMocks();

    branchName = 'feature/current';
    const testPoller = poller as unknown as {
      generation: number;
      pollOne(generation: number, untracked: GitStatusUntrackedMode): Promise<void>;
    };
    await testPoller.pollOne(testPoller.generation, 'no');

    expect(events.emit).toHaveBeenCalledWith(expect.anything(), {
      projectId: 'project-id',
      workspaceId: 'workspace-id',
      kind: 'head',
    });
    expect(events.emit).toHaveBeenCalledTimes(1);
    poller.stop();
  });
});
