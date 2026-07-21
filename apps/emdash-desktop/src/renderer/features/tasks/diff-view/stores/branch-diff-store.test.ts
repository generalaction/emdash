import type { GitChange, GitObjectRef } from '@emdash/core/git';
import { autorun, makeAutoObservable } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import type { GitWorktreeStore } from '@renderer/features/tasks/stores/git-worktree-store';
import { rpc } from '@renderer/lib/ipc';
import { BranchDiffStore } from './branch-diff-store';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      gitWorktree: {
        getChangedFiles: vi.fn(),
        getMergeBase: vi.fn(),
      },
    },
  },
  events: {
    on: vi.fn(() => () => {}),
  },
}));

type FakeBranchRef =
  | { type: 'local'; branch: string }
  | { type: 'remote'; branch: string; remote: { name: string; url: string } };

class FakeGitRepositoryStore {
  defaultBranch: FakeBranchRef | undefined = {
    type: 'local',
    branch: 'main',
  };
  constructor() {
    makeAutoObservable(this);
  }
}

class FakeGitWorktreeStore {
  branchName: string | null = 'feature/x';
  headKind: 'branch' | 'detached' | 'unborn' = 'branch';
  // Head OID is read via a method to mirror the real store's mirror-model accessor.
  currentHeadOid(): string | null {
    return this.headKind === 'unborn' ? null : 'aaaa1111';
  }
  constructor() {
    makeAutoObservable(this);
  }
}

const change = (path: string): GitChange => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 0,
});

function createStore(overrides?: {
  defaultBranch?: FakeGitRepositoryStore['defaultBranch'];
  head?: FakeGitWorktreeStore;
}) {
  const repo = new FakeGitRepositoryStore();
  if (overrides && 'defaultBranch' in overrides) repo.defaultBranch = overrides.defaultBranch;
  const worktree = overrides?.head ?? new FakeGitWorktreeStore();
  const store = new BranchDiffStore(
    'proj-1',
    'ws-1',
    repo as unknown as GitRepositoryStore,
    worktree as unknown as GitWorktreeStore
  );
  return { repo, worktree, store };
}

describe('BranchDiffStore', () => {
  beforeEach(() => {
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mockResolvedValue({
      success: true,
      data: { changes: [change('a.ts'), change('b.ts')] },
    });
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase).mockResolvedValue({
      success: true,
      data: { sha: null },
    });
  });

  it('defaults to committed mode', () => {
    // arrange / act
    const { store } = createStore();

    // assert
    expect(store.compareMode).toBe('committed');
  });

  it('exposes isAvailable=true when defaultBranch is resolvable', () => {
    // arrange / act
    const { store } = createStore();

    // assert
    expect(store.isAvailable).toBe(true);
  });

  it('returns emptyState no-default-branch when defaultBranch is undefined', () => {
    // arrange / act
    const { store } = createStore({ defaultBranch: undefined });

    // assert
    expect(store.isAvailable).toBe(false);
    expect(store.emptyState).toEqual({ kind: 'no-default-branch' });
  });

  it('returns emptyState on-default-branch when current branch equals default', () => {
    // arrange
    const head = new FakeGitWorktreeStore();
    head.branchName = 'main';

    // act
    const { store } = createStore({ head });

    // assert
    expect(store.emptyState).toEqual({ kind: 'on-default-branch' });
  });

  it('returns emptyState on-default-branch when default is a remote ref of the same branch name', () => {
    // arrange — worktree on local `main`, project's defaultBranch configured as `origin/main`
    const head = new FakeGitWorktreeStore();
    head.branchName = 'main';

    // act
    const { store } = createStore({
      head,
      defaultBranch: {
        type: 'remote',
        branch: 'main',
        remote: { name: 'origin', url: 'https://github.com/example/repo.git' },
      },
    });

    // assert — without the local↔remote-name match in isOnDefaultBranch, this
    // would fall through to a Branch comparison against the live ref instead
    // of the empty state.
    expect(store.emptyState).toEqual({ kind: 'on-default-branch' });
  });

  it('returns emptyState unborn when HEAD is unborn', () => {
    // arrange
    const head = new FakeGitWorktreeStore();
    head.headKind = 'unborn';
    head.branchName = null;

    // act
    const { store } = createStore({ head });

    // assert
    expect(store.emptyState).toEqual({ kind: 'unborn' });
  });

  it('produces a commit-ref for currentBranchRef when HEAD is detached', () => {
    // arrange
    const head = new FakeGitWorktreeStore();
    head.headKind = 'detached';
    head.branchName = null;

    // act
    const { store } = createStore({ head });
    const ref = store.currentBranchRef;

    // assert
    expect(ref).toEqual({ kind: 'commit', sha: 'aaaa1111' } satisfies GitObjectRef);
  });

  it('switches compareMode via setCompareMode', () => {
    // arrange
    const { store } = createStore();

    // act
    store.setCompareMode('all');

    // assert
    expect(store.compareMode).toBe('all');
  });

  it('resolves mergeBaseRef to a commit ref after the rpc returns a sha', async () => {
    // arrange
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase).mockResolvedValueOnce({
      success: true,
      data: { sha: 'cafebabe1234' },
    });
    const { store } = createStore();
    const snapshots: Array<GitObjectRef | null> = [];
    const dispose = autorun(() => {
      snapshots.push(store.mergeBaseRef);
    });

    // act — wait for the async resource to settle
    await new Promise<void>((r) => setTimeout(r, 0));
    dispose();

    // assert — autorun should have observed the transition null -> commit ref
    expect(snapshots).toContainEqual({
      kind: 'commit',
      sha: 'cafebabe1234',
    } satisfies GitObjectRef);
    expect(store.mergeBaseRef).toEqual({
      kind: 'commit',
      sha: 'cafebabe1234',
    } satisfies GitObjectRef);
  });

  it('leaves mergeBaseRef null when the rpc reports no common ancestor', async () => {
    // arrange
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase).mockResolvedValueOnce({
      success: true,
      data: { sha: null },
    });
    const { store } = createStore();

    // act
    await new Promise<void>((r) => setTimeout(r, 0));

    // assert
    expect(store.mergeBaseRef).toBeNull();
  });

  it('All mode requests the file list against the merge-base commit, not the default branch tip', async () => {
    // arrange
    vi.clearAllMocks();
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase).mockResolvedValue({
      success: true,
      data: { sha: 'deadbeef9999' },
    });
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mockResolvedValue({
      success: true,
      data: { changes: [] },
    });

    const { store } = createStore();
    store.setCompareMode('all');

    // act
    await new Promise<void>((r) => setTimeout(r, 0));

    // assert — the last getChangedFiles call must use the merge-base commit
    // ref as the diff target, not the live defaultBranch ref. Without this the
    // diff loses files whenever main independently catches up to the same
    // content (e.g. after a squash merge or a parallel PR).
    const calls = vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [, , target] = calls[calls.length - 1]!;
    expect(target).toEqual({ kind: 'commit', sha: 'deadbeef9999' } satisfies GitObjectRef);
  });

  it('files computed reflects new resource data after compareMode changes', async () => {
    // arrange
    vi.clearAllMocks();
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles)
      .mockResolvedValueOnce({ success: true, data: { changes: [change('a.ts')] } })
      .mockResolvedValueOnce({ success: true, data: { changes: [change('b.ts')] } });

    const { store } = createStore();

    // Subscribe to store.files via autorun to make it an observed computed.
    // Without observable.ref on _resource, the computed would never re-evaluate
    // after _rebuildResource swaps the resource, so filesSnapshots would only
    // ever contain the stale initial value.
    const filesSnapshots: string[][] = [];
    const disposeAutorun = autorun(() => {
      filesSnapshots.push(store.files.map((f) => f.path));
    });

    // wait for the initial resource load triggered by fireImmediately reaction
    await new Promise<void>((r) => setTimeout(r, 0));

    // act
    store.setCompareMode('all');
    await new Promise<void>((r) => setTimeout(r, 0));

    disposeAutorun();

    // assert: files eventually reflected b.ts (the second mock response)
    expect(filesSnapshots).toContainEqual(['b.ts']);
  });

  it('originalRef stays null while the first merge-base resolution is in flight', async () => {
    // arrange — block the getMergeBase response so we can observe the loading window
    vi.clearAllMocks();
    let resolveMb: (value: { success: true; data: { sha: string | null } }) => void = () => {};
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMb = resolve;
        })
    );
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mockResolvedValue({
      success: true,
      data: { changes: [] },
    });

    const { store } = createStore();

    // act / assert — during the pending RPC, originalRef must be null so click
    // handlers can't accidentally open a Branch diff tab pinned to the live
    // default-branch tip.
    expect(store.originalRef).toBeNull();

    resolveMb({ success: true, data: { sha: 'feedface5678' } });
    await new Promise<void>((r) => setTimeout(r, 0));

    // After resolution it returns the merge-base commit ref.
    expect(store.originalRef).toEqual({
      kind: 'commit',
      sha: 'feedface5678',
    } satisfies GitObjectRef);
  });

  it('originalRef falls back to defaultBranchRef only after merge-base settles with no common ancestor', async () => {
    // arrange — orphan-branches case: getMergeBase resolves to sha: null
    vi.clearAllMocks();
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase).mockResolvedValueOnce({
      success: true,
      data: { sha: null },
    });
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mockResolvedValue({
      success: true,
      data: { changes: [] },
    });

    const { store } = createStore();

    // act
    await new Promise<void>((r) => setTimeout(r, 0));

    // assert — after settle with no ancestor, defaultBranchRef is the only
    // meaningful base. Before settle it would have been null (covered above).
    expect(store.originalRef).toEqual({
      kind: 'branch',
      branch: { type: 'local', branch: 'main' },
    } satisfies GitObjectRef);
  });

  it('drops a stale merge-base response when a newer fetch has superseded it', async () => {
    // arrange — first getMergeBase is slow, second is fast and lands first
    vi.clearAllMocks();
    let resolveSlow: (value: { success: true; data: { sha: string | null } }) => void = () => {};
    vi.mocked(rpc.workspace.gitWorktree.getMergeBase)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          })
      )
      .mockResolvedValueOnce({
        success: true,
        data: { sha: 'newnewnewnewnew0' },
      });
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mockResolvedValue({
      success: true,
      data: { changes: [] },
    });

    const { store } = createStore();

    // act — fire a compareMode change to spawn fetch #2 before fetch #1 returns
    store.setCompareMode('all');
    await new Promise<void>((r) => setTimeout(r, 0));

    // sanity: fetch #2 has settled
    expect(store.mergeBaseRef).toEqual({
      kind: 'commit',
      sha: 'newnewnewnewnew0',
    } satisfies GitObjectRef);

    // now let fetch #1 (the superseded one) return — its callback must be
    // dropped by the generation check, otherwise it would clobber the newer
    // SHA and the diff tab's left side would point at the wrong base.
    resolveSlow({ success: true, data: { sha: 'oldoldoldoldold0' } });
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.mergeBaseRef).toEqual({
      kind: 'commit',
      sha: 'newnewnewnewnew0',
    } satisfies GitObjectRef);
  });
});
