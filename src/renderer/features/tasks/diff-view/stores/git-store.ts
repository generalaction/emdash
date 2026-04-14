import { computed, makeObservable, reaction } from 'mobx';
import { toast } from 'sonner';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { GitChange } from '@shared/git';
import { err, ok } from '@shared/result';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { events, rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';

interface GitStatusData {
  changes: GitChange[];
  currentBranch: string | null;
  totalLinesAdded: number;
  totalLinesDeleted: number;
}

export class GitStore {
  readonly status: Resource<GitStatusData>;

  constructor(
    private readonly projectId: string,
    private readonly workspaceId: string,
    private readonly repositoryStore: RepositoryStore
  ) {
    this.status = new Resource<GitStatusData>(
      () => this._fetchStatus(),
      [
        {
          kind: 'event',
          subscribe: (handler) => {
            rpc.fs.watchSetPaths(projectId, workspaceId, ['.git'], 'git-store').catch(() => {});
            const unsub = events.on(fsWatchEventChannel, () => handler(), workspaceId);
            return () => {
              unsub();
              rpc.fs.watchStop(projectId, workspaceId, 'git-store').catch(() => {});
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

  // ---------------------------------------------------------------------------
  // Forwarded computed getters — all existing consumer sites unchanged
  // ---------------------------------------------------------------------------

  get fileChanges(): GitChange[] {
    return this.status.data?.changes ?? [];
  }

  get stagedFileChanges(): GitChange[] {
    return this.status.data?.changes.filter((c) => c.isStaged) ?? [];
  }

  get unstagedFileChanges(): GitChange[] {
    return this.status.data?.changes.filter((c) => !c.isStaged) ?? [];
  }

  get totalLinesAdded(): number {
    return this.status.data?.totalLinesAdded ?? 0;
  }

  get totalLinesDeleted(): number {
    return this.status.data?.totalLinesDeleted ?? 0;
  }

  get isLoading(): boolean {
    return this.status.loading;
  }

  get error(): string | undefined {
    return this.status.error;
  }

  /** Current branch checked out in this workspace (worktree). Null for detached HEAD. */
  get branchName(): string | null {
    return this.status.data?.currentBranch ?? null;
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
   * Start watching — triggers initial load and activates the FS-event strategy.
   * Called from WorkspaceStore.activate().
   */
  startWatching(): void {
    this.status.start();
  }

  dispose(): void {
    this.status.dispose();
  }

  // ---------------------------------------------------------------------------
  // Mutation methods — invalidate relevant resources after each mutation
  // ---------------------------------------------------------------------------

  async stageFiles(paths: string[]): Promise<void> {
    await rpc.git.stageFiles(this.projectId, this.workspaceId, paths);
    this.status.invalidate();
  }

  async stageAllFiles(): Promise<void> {
    await rpc.git.stageAllFiles(this.projectId, this.workspaceId);
    this.status.invalidate();
  }

  async unstageFiles(paths: string[]): Promise<void> {
    await rpc.git.unstageFiles(this.projectId, this.workspaceId, paths);
    this.status.invalidate();
  }

  async unstageAllFiles(): Promise<void> {
    await rpc.git.unstageAllFiles(this.projectId, this.workspaceId);
    this.status.invalidate();
  }

  async discardFiles(paths: string[]): Promise<void> {
    await rpc.git.revertFiles(this.projectId, this.workspaceId, paths);
    this.status.invalidate();
  }

  async discardAllFiles(): Promise<void> {
    await rpc.git.revertAllFiles(this.projectId, this.workspaceId);
    this.status.invalidate();
  }

  async commit(message: string) {
    const result = await rpc.git.commit(this.projectId, this.workspaceId, message);
    if (result.success) {
      this.status.invalidate();
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
      this.status.invalidate();
      this.repositoryStore.refreshLocal(); // local branch updated with pulled commits
      return ok();
    } else {
      toast.error(`Failed to pull changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  // ---------------------------------------------------------------------------
  // Private fetch helpers
  // ---------------------------------------------------------------------------

  private async _fetchStatus(): Promise<GitStatusData> {
    const result = await rpc.git.getStatus(this.projectId, this.workspaceId);
    if (!result.success) throw new Error(result.error.type);
    const { changes, currentBranch } = result.data;
    return {
      changes,
      currentBranch,
      totalLinesAdded: changes.reduce((sum, c) => sum + c.additions, 0),
      totalLinesDeleted: changes.reduce((sum, c) => sum + c.deletions, 0),
    };
  }
}

// ---------------------------------------------------------------------------
// Keep reaction helper for PrStore and DiffViewStore that need to react to
// git file changes (replaces the old direct observable reference).
// ---------------------------------------------------------------------------
export function subscribeToGitFileChanges(git: GitStore, handler: () => void): () => void {
  return reaction(() => git.status.data, handler);
}
