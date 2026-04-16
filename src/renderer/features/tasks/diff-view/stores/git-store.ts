import { computed, makeObservable } from 'mobx';
import { toast } from 'sonner';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import type { FullGitStatus, GitChange } from '@shared/git';
import { err, ok } from '@shared/result';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

const TOO_MANY_FILES_MSG = 'Too many files changed to display';

export class GitStore {
  readonly fullStatus: Resource<FullGitStatus>;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore
  ) {
    this.fullStatus = new Resource<FullGitStatus>(
      () => this._fetchFullStatus(),
      [
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitWorkspaceChangedChannel, (payload) => {
              if (payload.workspaceId === this.workspaceId && payload.kind === 'head') {
                handler();
              }
            }),
          onEvent: 'reload',
          debounceMs: 100,
        },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitWorkspaceChangedChannel, (payload) => {
              if (payload.workspaceId === this.workspaceId && payload.kind === 'index') {
                handler();
              }
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
        {
          kind: 'event',
          subscribe: (handler) => {
            rpc.fs.watchSetPaths(projectId, workspaceId, [''], 'git-store-status').catch(() => {});
            const unsub = events.on(fsWatchEventChannel, (payload) => {
              if (payload.workspaceId !== workspaceId) return;
              const relevant = payload.events.some((e) => {
                if (e.path.startsWith('.git')) return false;
                if (e.oldPath?.startsWith('.git')) return false;
                return true;
              });
              if (relevant) handler();
            });
            return () => {
              unsub();
              rpc.fs.watchStop(projectId, workspaceId, 'git-store-status').catch(() => {});
            };
          },
          onEvent: 'reload',
          debounceMs: 500,
        },
      ]
    );

    makeObservable(this, {
      fileChanges: computed,
      stagedFileChanges: computed,
      unstagedFileChanges: computed,
      totalLinesAdded: computed,
      totalLinesDeleted: computed,
      isLoading: computed,
      error: computed,
      isBranchPublished: computed,
      aheadCount: computed,
      behindCount: computed,
      branchName: computed,
    });
  }

  /**
   * One entry per path — combines staged + unstaged halves for paths in both (e.g. MM).
   */
  get fileChanges(): GitChange[] {
    const m = new Map<string, { staged?: GitChange; unstaged?: GitChange }>();
    for (const c of this.stagedFileChanges) {
      m.set(c.path, { ...m.get(c.path), staged: c });
    }
    for (const c of this.unstagedFileChanges) {
      m.set(c.path, { ...m.get(c.path), unstaged: c });
    }
    const out: GitChange[] = [];
    for (const { staged, unstaged } of m.values()) {
      if (staged && unstaged) {
        out.push({
          path: staged.path,
          status: 'modified',
          additions: staged.additions + unstaged.additions,
          deletions: staged.deletions + unstaged.deletions,
          isStaged: true,
        });
      } else if (staged) {
        out.push(staged);
      } else if (unstaged) {
        out.push(unstaged);
      }
    }
    return out;
  }

  get stagedFileChanges(): GitChange[] {
    return this.fullStatus.data?.staged ?? [];
  }

  get unstagedFileChanges(): GitChange[] {
    return this.fullStatus.data?.unstaged ?? [];
  }

  get totalLinesAdded(): number {
    const full = this.fullStatus.data;
    if (!full) return 0;
    const u = full.unstaged.reduce((s, c) => s + c.additions, 0);
    return full.totalAdded + u;
  }

  get totalLinesDeleted(): number {
    const full = this.fullStatus.data;
    if (!full) return 0;
    const u = full.unstaged.reduce((s, c) => s + c.deletions, 0);
    return full.totalDeleted + u;
  }

  get isLoading(): boolean {
    return this.fullStatus.loading;
  }

  get error(): string | undefined {
    return this.fullStatus.error;
  }

  get branchName(): string | null {
    return this.fullStatus.data?.currentBranch ?? null;
  }

  /** True when this workspace's branch has a remote tracking ref. */
  get isBranchPublished(): boolean {
    const name = this.branchName;
    return name ? this.repositoryStore.isBranchOnRemote(name) : false;
  }

  /** Commits this workspace's branch is ahead of its upstream. */
  get aheadCount(): number {
    const name = this.branchName;
    return name ? (this.repositoryStore.getBranchDivergence(name)?.ahead ?? 0) : 0;
  }

  /** Commits this workspace's branch is behind its upstream. */
  get behindCount(): number {
    const name = this.branchName;
    return name ? (this.repositoryStore.getBranchDivergence(name)?.behind ?? 0) : 0;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Start watching — triggers initial load and activates event strategies.
   * Called from WorkspaceStore.activate().
   */
  startWatching(): void {
    this.fullStatus.start();
  }

  dispose(): void {
    this.fullStatus.dispose();
  }

  // ---------------------------------------------------------------------------
  // Mutation methods — optimistic update then authoritative reload
  // ---------------------------------------------------------------------------

  /**
   * Apply an optimistic transformation to fullStatus immediately, returning the
   * previous value so callers can roll back on error.
   */
  private _applyOptimistic(fn: (prev: FullGitStatus) => FullGitStatus): FullGitStatus | null {
    const prev = this.fullStatus.data;
    if (prev) this.fullStatus.setValue(fn(prev));
    return prev;
  }

  async stageFiles(paths: string[]): Promise<void> {
    const pathSet = new Set(paths);
    const previous = this._applyOptimistic((prev) => {
      const moving = prev.unstaged.filter((c) => pathSet.has(c.path));
      return {
        ...prev,
        staged: [...prev.staged, ...moving.map((c) => ({ ...c, isStaged: true }))],
        unstaged: prev.unstaged.filter((c) => !pathSet.has(c.path)),
        totalAdded: prev.totalAdded + moving.reduce((s, c) => s + c.additions, 0),
        totalDeleted: prev.totalDeleted + moving.reduce((s, c) => s + c.deletions, 0),
      };
    });
    try {
      await rpc.git.stageFiles(this.projectId, this.workspaceId, paths);
      this.fullStatus.invalidate();
    } catch (e) {
      if (previous) this.fullStatus.setValue(previous);
      throw e;
    }
  }

  async stageAllFiles(): Promise<void> {
    const previous = this._applyOptimistic((prev) => {
      const allStaged = [...prev.staged, ...prev.unstaged.map((c) => ({ ...c, isStaged: true }))];
      return {
        ...prev,
        staged: allStaged,
        unstaged: [],
        totalAdded: allStaged.reduce((s, c) => s + c.additions, 0),
        totalDeleted: allStaged.reduce((s, c) => s + c.deletions, 0),
      };
    });
    try {
      await rpc.git.stageAllFiles(this.projectId, this.workspaceId);
      this.fullStatus.invalidate();
    } catch (e) {
      if (previous) this.fullStatus.setValue(previous);
      throw e;
    }
  }

  async unstageFiles(paths: string[]): Promise<void> {
    const pathSet = new Set(paths);
    const previous = this._applyOptimistic((prev) => {
      const moving = prev.staged.filter((c) => pathSet.has(c.path));
      return {
        ...prev,
        staged: prev.staged.filter((c) => !pathSet.has(c.path)),
        unstaged: [...prev.unstaged, ...moving.map((c) => ({ ...c, isStaged: false }))],
        totalAdded: prev.totalAdded - moving.reduce((s, c) => s + c.additions, 0),
        totalDeleted: prev.totalDeleted - moving.reduce((s, c) => s + c.deletions, 0),
      };
    });
    try {
      await rpc.git.unstageFiles(this.projectId, this.workspaceId, paths);
      this.fullStatus.invalidate();
    } catch (e) {
      if (previous) this.fullStatus.setValue(previous);
      throw e;
    }
  }

  async unstageAllFiles(): Promise<void> {
    const previous = this._applyOptimistic((prev) => ({
      ...prev,
      staged: [],
      unstaged: [...prev.unstaged, ...prev.staged.map((c) => ({ ...c, isStaged: false }))],
      totalAdded: 0,
      totalDeleted: 0,
    }));
    try {
      await rpc.git.unstageAllFiles(this.projectId, this.workspaceId);
      this.fullStatus.invalidate();
    } catch (e) {
      if (previous) this.fullStatus.setValue(previous);
      throw e;
    }
  }

  async discardFiles(paths: string[]): Promise<void> {
    const pathSet = new Set(paths);
    const previous = this._applyOptimistic((prev) => ({
      ...prev,
      unstaged: prev.unstaged.filter((c) => !pathSet.has(c.path)),
    }));
    try {
      await rpc.git.revertFiles(this.projectId, this.workspaceId, paths);
      this.fullStatus.invalidate();
    } catch (e) {
      if (previous) this.fullStatus.setValue(previous);
      throw e;
    }
  }

  async discardAllFiles(): Promise<void> {
    const previous = this._applyOptimistic((prev) => ({ ...prev, unstaged: [] }));
    try {
      await rpc.git.revertAllFiles(this.projectId, this.workspaceId);
      this.fullStatus.invalidate();
    } catch (e) {
      if (previous) this.fullStatus.setValue(previous);
      throw e;
    }
  }

  async commit(message: string) {
    const result = await rpc.git.commit(this.projectId, this.workspaceId, message);
    if (result.success) {
      // Clear staged list immediately so the UI doesn't flash stale state
      // while the authoritative reload is in flight.
      this._applyOptimistic((prev) => ({
        ...prev,
        staged: [],
        totalAdded: 0,
        totalDeleted: 0,
      }));
      this.fullStatus.invalidate();
      this.repositoryStore.refreshLocal(); // new commit → local branch ahead count changes
      return ok();
    } else {
      toast.error(`Failed to commit changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  async fetchRemote() {
    const result = await rpc.git.fetch(this.projectId, this.workspaceId);
    if (result.success) {
      this.repositoryStore.refreshRemote(); // fetch updates remote-tracking refs
      return ok();
    } else {
      toast.error(`Failed to fetch remote changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  async push() {
    const remote = this.repositoryStore.configuredRemote;
    const result = await rpc.git.push(this.projectId, this.workspaceId, remote);
    if (result.success) {
      this.repositoryStore.refreshLocal(); // divergence resets to 0
      this.repositoryStore.refreshRemote(); // remote now has the commits
      return ok();
    } else {
      const detail =
        'message' in result.error ? (result.error.message ?? result.error.type) : result.error.type;
      toast.error(`Failed to push: ${detail}`);
      return err(result.error);
    }
  }

  async publishBranch() {
    const branchName = this.branchName;
    if (!branchName) return err({ type: 'git_error' as const, message: 'No branch checked out' });
    const remote = this.repositoryStore.configuredRemote;
    const result = await rpc.git.publishBranch(
      this.projectId,
      this.workspaceId,
      branchName,
      remote
    );
    if (result.success) {
      this.repositoryStore.refreshRemote(); // branch now exists on remote
      return ok();
    } else {
      const detail =
        'message' in result.error ? (result.error.message ?? result.error.type) : result.error.type;
      toast.error(`Failed to publish branch: ${detail}`);
      return err(result.error);
    }
  }

  async pull() {
    const result = await rpc.git.pull(this.projectId, this.workspaceId);
    if (result.success) {
      this.fullStatus.invalidate();
      this.repositoryStore.refreshLocal(); // local branch updated with pulled commits
      return ok();
    } else {
      toast.error(`Failed to pull changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  private async _fetchFullStatus(): Promise<FullGitStatus> {
    const result = await rpc.git.getFullStatus(this.projectId, this.workspaceId);
    if (!result.success) {
      if (result.error.type === 'too_many_files') {
        throw new Error(TOO_MANY_FILES_MSG);
      }
      throw new Error(result.error.type);
    }
    return result.data;
  }
}
