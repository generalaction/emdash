import type { GitChange, GitObjectRef } from '@emdash/core/git';
import { autorun, makeAutoObservable } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { rpc } from '@renderer/lib/ipc';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import type { GitWorktreeStore } from '@renderer/features/tasks/stores/git-worktree-store';
import { BranchDiffStore } from './branch-diff-store';

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    workspace: {
      gitWorktree: {
        getChangedFiles: vi.fn(),
      },
    },
  },
  events: {
    on: vi.fn(() => () => {}),
  },
}));

class FakeGitRepositoryStore {
  defaultBranch: { type: 'local'; branch: string } | undefined = {
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
    worktree as unknown as GitWorktreeStore,
  );
  return { repo, worktree, store };
}

describe('BranchDiffStore', () => {
  beforeEach(() => {
    vi.mocked(rpc.workspace.gitWorktree.getChangedFiles).mockResolvedValue({
      success: true,
      data: { changes: [change('a.ts'), change('b.ts')] },
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
});
