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
  private _mergeBaseSha: string | null = null;
  /**
   * True after at least one `getMergeBase` response has been processed.
   * Distinguishes "never fetched yet" from "fetched, no common ancestor"
   * so consumers can avoid opening Branch diff tabs while the very first
   * resolution is still in flight (which would otherwise fall back to
   * the live default-branch tip and defeat the merge-base pin).
   */
  private _mergeBaseResolved = false;
  private _disposeReactions: Array<() => void> = [];
  /**
   * Incremented on every `_rebuildResource` call so late-arriving callbacks
   * from a superseded fetch don't overwrite state owned by a newer one.
   * Without this, a slow `getMergeBase` from compareMode-change #1 can land
   * after compareMode-change #2's faster response and leave `_mergeBaseSha`
   * pointing at the wrong commit (file list comes from the new base, merge-
   * base from the old).
   */
  private _loadGeneration = 0;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly gitRepository: GitRepositoryStore,
    private readonly gitWorktree: GitWorktreeStore
  ) {
    makeObservable<this, '_resource' | '_mergeBaseSha' | '_mergeBaseResolved'>(this, {
      _resource: observable.ref,
      _mergeBaseSha: observable,
      _mergeBaseResolved: observable,
      compareMode: observable,
      defaultBranchRef: computed,
      currentBranchRef: computed,
      mergeBaseRef: computed,
      originalRef: computed,
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
            a.mode === b.mode && refsEqualOrNull(a.base, b.base) && refsEqualOrNull(a.head, b.head),
          fireImmediately: true,
        }
      )
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

  /**
   * Commit ref of `merge-base(defaultBranch, currentBranch)` — the point this
   * branch diverged from the default branch. Pinned client-side so the diff view
   * matches the file list's three-dot semantics even after the branch's PR has
   * been squash-merged into the default (where the two branch tips would
   * otherwise be content-equal).
   *
   * Null until resolved, or when defaultBranchRef/currentBranchRef are missing.
   */
  get mergeBaseRef(): GitObjectRef | null {
    return this._mergeBaseSha ? commitRef(this._mergeBaseSha) : null;
  }

  /**
   * The ref to use as the original (left) side of a Branch diff tab. Resolves
   * to the merge-base commit when available, and to the default-branch tip
   * only AFTER the first merge-base resolution has settled with no common
   * ancestor (orphan branches — a pathological case where any base is wrong).
   *
   * Returns null while the very first resolution is still in flight so callers
   * don't accidentally open a tab pinned to the live default branch tip, which
   * would defeat the merge-base pin (the empty-diff-after-squash-merge bug
   * this whole flow is designed to avoid).
   */
  get originalRef(): GitObjectRef | null {
    if (this._mergeBaseSha) return commitRef(this._mergeBaseSha);
    if (this._mergeBaseResolved) return this.defaultBranchRef;
    return null;
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
    if (this.currentBranchRef && isOnDefaultBranch(this.defaultBranchRef, this.currentBranchRef)) {
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
    this._loadGeneration++;
    runInAction(() => {
      this._mergeBaseSha = null;
      this._mergeBaseResolved = false;
    });
  }

  private _rebuildResource(): void {
    this._resource?.dispose();
    const base = this.defaultBranchRef;
    const head = this.currentBranchRef;
    if (!base || !head) {
      this._loadGeneration++;
      runInAction(() => {
        this._resource = null;
        this._mergeBaseSha = null;
        this._mergeBaseResolved = false;
      });
      return;
    }
    const mode = this.compareMode;
    const projectId = this.projectId;
    const workspaceId = this.workspaceId;
    const generation = ++this._loadGeneration;

    const resource = new Resource<readonly GitChange[]>(async () => {
      // Resolve merge-base first so both modes can compare against the branch
      // point. Without that, All would compare working tree against the live
      // default-branch tip — anything main independently added (e.g. a
      // squash-merge or a parallel PR that lands the same final content) would
      // disappear from All while still showing up in Committed, making All
      // look like a subset of Committed even though it conceptually contains it.
      const mergeBaseResult = await rpc.workspace.gitWorktree.getMergeBase(
        projectId,
        workspaceId,
        base,
        head
      );
      // Drop this result if a newer _rebuildResource has started — late
      // returns from a superseded fetch must not overwrite newer state.
      if (this._loadGeneration !== generation) {
        return this._resource?.data ?? [];
      }
      const mergeBaseSha = mergeBaseResult.success ? mergeBaseResult.data.sha : null;
      runInAction(() => {
        this._mergeBaseSha = mergeBaseSha;
        this._mergeBaseResolved = true;
      });

      const effectiveBase: GitObjectRef = mergeBaseSha ? commitRef(mergeBaseSha) : base;
      const target = mode === 'committed' ? mergeBaseRange(effectiveBase, head) : effectiveBase;
      const filesResult = await rpc.workspace.gitWorktree.getChangedFiles(
        projectId,
        workspaceId,
        target
      );
      if (this._loadGeneration !== generation) {
        return this._resource?.data ?? [];
      }
      return filesResult.success ? filesResult.data.changes : [];
    }, [
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
    ]);
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

/**
 * "Are we currently checked out on the default branch?" — true when both refs
 * are branches with the same branch name, regardless of whether the configured
 * default is a local or a remote-tracking ref (e.g. `main` vs `origin/main`).
 *
 * `refsEqual` rejects local↔remote pairs as different `branch.type`, so without
 * this we'd miss the "On default branch" empty state and instead render a
 * Branch comparison against the worktree's own ref.
 */
function isOnDefaultBranch(defaultRef: GitObjectRef, currentRef: GitObjectRef): boolean {
  if (defaultRef.kind === 'branch' && currentRef.kind === 'branch') {
    return defaultRef.branch.branch === currentRef.branch.branch;
  }
  return refsEqual(defaultRef, currentRef);
}
