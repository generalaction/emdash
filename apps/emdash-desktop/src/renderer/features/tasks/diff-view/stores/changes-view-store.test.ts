import type { GitChange } from '@emdash/shared/git';
import { makeAutoObservable, runInAction } from 'mobx';
import { describe, expect, it } from 'vitest';
import { type PrStore } from '@renderer/features/tasks/stores/pr-store';
import { type GitWorktreeStore } from '../../stores/git-worktree-store';
import { ChangesViewStore } from './changes-view-store';

class FakeGitWorktreeStore {
  unstagedFileChanges: GitChange[] = [];
  stagedFileChanges: GitChange[] = [];
  isLoading = true;
  error: string | undefined = undefined;

  constructor() {
    makeAutoObservable(this);
  }

  setStatus({
    unstaged = this.unstagedFileChanges,
    staged = this.stagedFileChanges,
  }: {
    unstaged?: GitChange[];
    staged?: GitChange[];
  }) {
    this.unstagedFileChanges = unstaged;
    this.stagedFileChanges = staged;
    this.isLoading = false;
  }
}

class FakePrStore {
  pullRequests: unknown[] = [];

  constructor() {
    makeAutoObservable(this);
  }

  setPullRequests(count: number) {
    this.pullRequests = Array.from({ length: count }, (_, i) => ({ id: i }));
  }
}

const change = (path: string): GitChange => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 0,
});

function createStore() {
  const git = new FakeGitWorktreeStore();
  const pr = new FakePrStore();
  const store = new ChangesViewStore(git as unknown as GitWorktreeStore, pr as unknown as PrStore);

  return { git, pr, store };
}

describe('ChangesViewStore expanded sections', () => {
  it('opens changed files by default after the first git load', () => {
    const { git, store } = createStore();

    runInAction(() => git.setStatus({ unstaged: [change('src/a.ts')], staged: [] }));

    expect(store.expandedSections).toEqual({
      unstaged: true,
      staged: false,
      pullRequests: false,
    });
  });

  it('opens pull requests on the first load when pull requests exist', () => {
    const { git, pr, store } = createStore();

    runInAction(() => {
      pr.setPullRequests(1);
      git.setStatus({ unstaged: [], staged: [] });
    });

    expect(store.expandedSections).toEqual({
      unstaged: false,
      staged: false,
      pullRequests: true,
    });
  });

  it('opens staged files and closes changed files when the last changed file is staged', () => {
    const { git, store } = createStore();

    runInAction(() => git.setStatus({ unstaged: [change('src/a.ts')], staged: [] }));
    runInAction(() => git.setStatus({ unstaged: [], staged: [change('src/a.ts')] }));

    expect(store.expandedSections).toEqual({
      unstaged: false,
      staged: true,
      pullRequests: false,
    });
  });

  it('keeps changed files open when staging leaves other changed files behind', () => {
    const { git, store } = createStore();

    runInAction(() =>
      git.setStatus({ unstaged: [change('src/a.ts'), change('src/b.ts')], staged: [] })
    );
    runInAction(() =>
      git.setStatus({ unstaged: [change('src/b.ts')], staged: [change('src/a.ts')] })
    );

    expect(store.expandedSections).toEqual({
      unstaged: true,
      staged: true,
      pullRequests: false,
    });
  });

  it('removes only completed unstaged paths so newer selections survive', () => {
    const { git, store } = createStore();

    runInAction(() =>
      git.setStatus({
        unstaged: [change('src/a.ts'), change('src/b.ts'), change('src/c.ts')],
        staged: [],
      })
    );

    store.toggleUnstagedItem('src/a.ts');
    store.toggleUnstagedItem('src/b.ts');

    // The user selects another file while staging a.ts is still in flight.
    store.toggleUnstagedItem('src/c.ts');
    store.removeUnstagedSelection(['src/a.ts']);

    expect([...store.unstagedSelection]).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('removes only completed staged paths so newer selections survive', () => {
    const { git, store } = createStore();

    runInAction(() =>
      git.setStatus({
        unstaged: [],
        staged: [change('src/a.ts'), change('src/b.ts'), change('src/c.ts')],
      })
    );

    store.toggleStagedItem('src/a.ts');
    store.toggleStagedItem('src/b.ts');

    // The user selects another file while unstaging a.ts is still in flight.
    store.toggleStagedItem('src/c.ts');
    store.removeStagedSelection(['src/a.ts']);

    expect([...store.stagedSelection]).toEqual(['src/b.ts', 'src/c.ts']);
  });
});
