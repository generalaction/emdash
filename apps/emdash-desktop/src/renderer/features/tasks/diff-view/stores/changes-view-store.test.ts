import { makeAutoObservable, runInAction } from 'mobx';
import { describe, expect, it } from 'vitest';
import { type PrStore } from '@renderer/features/tasks/stores/pr-store';
import { type GitChange } from '@shared/core/git/git';
import { ChangesViewStore } from './changes-view-store';
import { type GitStore } from './git-store';

class FakeGitStore {
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
  const git = new FakeGitStore();
  const pr = new FakePrStore();
  const store = new ChangesViewStore(git as unknown as GitStore, pr as unknown as PrStore);

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
});
