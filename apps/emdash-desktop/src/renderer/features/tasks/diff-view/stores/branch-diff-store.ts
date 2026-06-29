import type { GitChange, GitObjectRef } from '@emdash/core/git';
import { action, computed, makeObservable, observable, reaction, runInAction } from 'mobx';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import type { GitWorktreeStore } from '@renderer/features/tasks/stores/git-worktree-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { gitRepoUpdateChannel, gitWorktreeUpdateChannel } from '@shared/core/git/events';
import { commitRef, localRef, mergeBaseRange, refsEqual } from '@shared/core/git/utils';

export type BranchCompareMode = 'committed' | 'all';

export type BranchEmptyState =
  | { kind: 'no-default-branch' }
  | { kind: 'default-not-resolved' }
  | { kind: 'on-default-branch' }
  | { kind: 'no-changes' }
  | { kind: 'unborn' };

export class BranchDiffStore {
  compareMode: BranchCompareMode = 'committed';

  private _resource: Resource<readonly GitChange[]> | null = null;
  private _disposeReactions: Array<() => void> = [];

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepository: GitRepositoryStore,
    private readonly gitWorktree: GitWorktreeStore,
  ) {
    makeObservable<this, '_resource'>(this, {
      _resource: observable.ref,
      compareMode: observable,
      defaultBranchRef: computed,
      currentBranchRef: computed,
      isAvailable: computed,
      files: computed,
      isLoading: computed,
      emptyState: computed,
      setCompareMode: action,
    });

    this._disposeReactions.push(
      reaction(
        () => ({
          mode: this.compareMode,
          base: this.defaultBranchRef,
          head: this.currentBranchRef,
        }),
        () => this._rebuildResource(),
        {
          equals: (a, b) =>
            a.mode === b.mode &&
            refsEqualOrNull(a.base, b.base) &&
            refsEqualOrNull(a.head, b.head),
          fireImmediately: true,
        },
      ),
    );
  }

  get defaultBranchRef(): GitObjectRef | null {
    const branch = this.gitRepository.defaultBranch;
    if (!branch) return null;
    return { kind: 'branch', branch };
  }

  get currentBranchRef(): GitObjectRef | null {
    if (this.gitWorktree.headKind === 'unborn') return null;
    if (this.gitWorktree.headKind === 'detached') {
      const oid = this.gitWorktree.currentHeadOid();
      return oid ? commitRef(oid) : null;
    }
    return this.gitWorktree.branchName ? localRef(this.gitWorktree.branchName) : null;
  }

  get isAvailable(): boolean {
    return this.defaultBranchRef != null;
  }

  get files(): readonly GitChange[] {
    return this._resource?.data ?? [];
  }

  get isLoading(): boolean {
    return this._resource?.loading ?? false;
  }

  get emptyState(): BranchEmptyState | null {
    if (!this.defaultBranchRef) return { kind: 'no-default-branch' };
    if (this.gitWorktree.headKind === 'unborn') return { kind: 'unborn' };
    if (
      this.currentBranchRef &&
      refsEqual(this.defaultBranchRef, this.currentBranchRef)
    ) {
      return { kind: 'on-default-branch' };
    }
    if (this.files.length > 0) return null;
    if (this.isLoading) return null;
    if (this._resource?.error) return { kind: 'default-not-resolved' };
    return { kind: 'no-changes' };
  }

  setCompareMode(mode: BranchCompareMode): void {
    this.compareMode = mode;
  }

  dispose(): void {
    for (const d of this._disposeReactions) d();
    this._disposeReactions = [];
    this._resource?.dispose();
    this._resource = null;
  }

  private _rebuildResource(): void {
    this._resource?.dispose();
    const base = this.defaultBranchRef;
    const head = this.currentBranchRef;
    if (!base || !head) {
      runInAction(() => {
        this._resource = null;
      });
      return;
    }
    const mode = this.compareMode;
    const projectId = this.projectId;
    const workspaceId = this.workspaceId;

    const resource = new Resource<readonly GitChange[]>(
      async () => {
        const target = mode === 'committed' ? mergeBaseRange(base, head) : base;
        const result = await rpc.workspace.gitWorktree.getChangedFiles(
          projectId,
          workspaceId,
          target,
        );
        return result.success ? result.data.changes : [];
      },
      [
        { kind: 'poll', intervalMs: 60_000, pauseWhenHidden: true, demandGated: true },
        {
          kind: 'event',
          subscribe: (handler) => {
            const unsubHead = events.on(gitWorktreeUpdateChannel, (p) => {
              if (p.workspaceId !== workspaceId) return;
              if (p.update.kind === 'head') handler();
              if (p.update.kind === 'status' && mode === 'all') handler();
            });
            const unsubRefs = events.on(gitRepoUpdateChannel, (p) => {
              if (p.projectId === projectId && p.update.kind === 'refs') handler();
            });
            return () => {
              unsubHead();
              unsubRefs();
            };
          },
          onEvent: 'reload',
          debounceMs: 500,
        },
      ],
    );
    resource.start();
    runInAction(() => {
      this._resource = resource;
    });
  }
}

function refsEqualOrNull(a: GitObjectRef | null, b: GitObjectRef | null): boolean {
  if (a === null || b === null) return a === b;
  return refsEqual(a, b);
}
