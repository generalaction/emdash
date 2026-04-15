import { computed, makeObservable } from 'mobx';
import { toast } from 'sonner';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import type { GitChange } from '@shared/git';
import { err, ok } from '@shared/result';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

interface StagedChangesData {
  changes: GitChange[];
  totalAdded: number;
  totalDeleted: number;
}

interface UnstagedChangesData {
  changes: GitChange[];
}

interface BranchInfoData {
  currentBranch: string | null;
}

export class GitStore {
  readonly stagedChanges: Resource<StagedChangesData>;
  readonly unstagedChanges: Resource<UnstagedChangesData>;
  readonly branchInfo: Resource<BranchInfoData>;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore
  ) {
    this.stagedChanges = new Resource<StagedChangesData>(
      () => this._fetchStagedChanges(),
      [
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitWorkspaceChangedChannel, (payload) => {
              if (
                payload.workspaceId === this.workspaceId &&
                (payload.kind === 'index' || payload.kind === 'head')
              ) {
                handler();
              }
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
      ]
    );

    this.unstagedChanges = new Resource<UnstagedChangesData>(
      () => this._fetchUnstagedChanges(),
      [
        {
          kind: 'event',
          subscribe: (handler) => {
            rpc.fs
              .watchSetPaths(projectId, workspaceId, [''], 'git-store-unstaged')
              .catch(() => {});
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
              rpc.fs.watchStop(projectId, workspaceId, 'git-store-unstaged').catch(() => {});
            };
          },
          onEvent: 'reload',
          debounceMs: 500,
        },
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitWorkspaceChangedChannel, (payload) => {
              if (payload.workspaceId === this.workspaceId && payload.kind === 'index') handler();
            }),
          onEvent: 'reload',
          debounceMs: 300,
        },
      ]
    );

    this.branchInfo = new Resource<BranchInfoData>(
      () => this._fetchBranchInfo(),
      [
        {
          kind: 'event',
          subscribe: (handler) =>
            events.on(gitWorkspaceChangedChannel, (payload) => {
              if (payload.workspaceId === workspaceId && payload.kind === 'head') handler();
            }),
          onEvent: 'reload',
          debounceMs: 100,
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
    return this.stagedChanges.data?.changes ?? [];
  }

  get unstagedFileChanges(): GitChange[] {
    return this.unstagedChanges.data?.changes ?? [];
  }

  get totalLinesAdded(): number {
    const staged = this.stagedChanges.data;
    const unstaged = this.unstagedChanges.data;
    const u = unstaged?.changes.reduce((s, c) => s + c.additions, 0) ?? 0;
    return (staged?.totalAdded ?? 0) + u;
  }

  get totalLinesDeleted(): number {
    const staged = this.stagedChanges.data;
    const unstaged = this.unstagedChanges.data;
    const u = unstaged?.changes.reduce((s, c) => s + c.deletions, 0) ?? 0;
    return (staged?.totalDeleted ?? 0) + u;
  }

  get isLoading(): boolean {
    return this.stagedChanges.loading || this.unstagedChanges.loading || this.branchInfo.loading;
  }

  get error(): string | undefined {
    return this.stagedChanges.error ?? this.unstagedChanges.error ?? this.branchInfo.error;
  }

  get branchName(): string | null {
    return this.branchInfo.data?.currentBranch ?? null;
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
    this.stagedChanges.start();
    this.unstagedChanges.start();
    this.branchInfo.start();
  }

  dispose(): void {
    this.stagedChanges.dispose();
    this.unstagedChanges.dispose();
    this.branchInfo.dispose();
  }

  // ---------------------------------------------------------------------------
  // Mutation methods — invalidate relevant resources after each mutation
  // ---------------------------------------------------------------------------

  async stageFiles(paths: string[]): Promise<void> {
    await rpc.git.stageFiles(this.projectId, this.workspaceId, paths);
    this.stagedChanges.invalidate();
    this.unstagedChanges.invalidate();
  }

  async stageAllFiles(): Promise<void> {
    await rpc.git.stageAllFiles(this.projectId, this.workspaceId);
    this.stagedChanges.invalidate();
    this.unstagedChanges.invalidate();
  }

  async unstageFiles(paths: string[]): Promise<void> {
    await rpc.git.unstageFiles(this.projectId, this.workspaceId, paths);
    this.stagedChanges.invalidate();
    this.unstagedChanges.invalidate();
  }

  async unstageAllFiles(): Promise<void> {
    await rpc.git.unstageAllFiles(this.projectId, this.workspaceId);
    this.stagedChanges.invalidate();
    this.unstagedChanges.invalidate();
  }

  async discardFiles(paths: string[]): Promise<void> {
    await rpc.git.revertFiles(this.projectId, this.workspaceId, paths);
    this.unstagedChanges.invalidate();
  }

  async discardAllFiles(): Promise<void> {
    await rpc.git.revertAllFiles(this.projectId, this.workspaceId);
    this.stagedChanges.invalidate();
    this.unstagedChanges.invalidate();
  }

  async commit(message: string) {
    const result = await rpc.git.commit(this.projectId, this.workspaceId, message);
    if (result.success) {
      this.stagedChanges.invalidate();
      this.branchInfo.invalidate();
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
      this.stagedChanges.invalidate();
      this.unstagedChanges.invalidate();
      this.branchInfo.invalidate();
      this.repositoryStore.refreshLocal(); // local branch updated with pulled commits
      return ok();
    } else {
      toast.error(`Failed to pull changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  private async _fetchStagedChanges(): Promise<StagedChangesData> {
    const result = await rpc.git.getStagedChanges(this.projectId, this.workspaceId);
    if (!result.success) throw new Error(result.error.type);
    return result.data;
  }

  private async _fetchUnstagedChanges(): Promise<UnstagedChangesData> {
    const result = await rpc.git.getUnstagedChanges(this.projectId, this.workspaceId);
    if (!result.success) throw new Error(result.error.type);
    return result.data;
  }

  private async _fetchBranchInfo(): Promise<BranchInfoData> {
    const result = await rpc.git.getCurrentBranch(this.projectId, this.workspaceId);
    if (!result.success) throw new Error(result.error.type);
    return { currentBranch: result.data.currentBranch };
  }
}
