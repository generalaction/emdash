import { computed, makeObservable, reaction } from 'mobx';
import { toast } from 'sonner';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { GitChange } from '@shared/git';
import { err, ok } from '@shared/result';
import { events, rpc } from '@renderer/core/ipc';
import { Resource } from './resource';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BranchStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

interface GitStatusData {
  changes: GitChange[];
  totalLinesAdded: number;
  totalLinesDeleted: number;
}

// ---------------------------------------------------------------------------
// GitStore
// ---------------------------------------------------------------------------

export class GitStore {
  readonly status: Resource<GitStatusData>;
  readonly branchStatus: Resource<BranchStatus>;

  constructor(
    private readonly projectId: string,
    private readonly getTaskId: () => string,
    private readonly workspaceId: string
  ) {
    this.status = new Resource<GitStatusData>(
      () => this._fetchStatus(),
      [
        {
          kind: 'event',
          subscribe: (handler) => {
            const taskId = this.getTaskId();
            rpc.fs.watchSetPaths(projectId, taskId, ['.git'], 'git-store').catch(() => {});
            const unsub = events.on(fsWatchEventChannel, () => handler(), workspaceId);
            return () => {
              unsub();
              rpc.fs.watchStop(projectId, taskId, 'git-store').catch(() => {});
            };
          },
          onEvent: 'reload',
          debounceMs: 400,
        },
      ]
    );

    this.branchStatus = new Resource<BranchStatus>(
      () => this._fetchBranchStatus(),
      [{ kind: 'poll', intervalMs: 10_000, pauseWhenHidden: true, demandGated: true }]
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

  get isBranchPublished(): boolean {
    return this.branchStatus.data?.upstream !== undefined;
  }

  get aheadCount(): number {
    return this.branchStatus.data?.ahead ?? 0;
  }

  get behindCount(): number {
    return this.branchStatus.data?.behind ?? 0;
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
    this.branchStatus.dispose();
  }

  // ---------------------------------------------------------------------------
  // Mutation methods — invalidate relevant resources after each mutation
  // ---------------------------------------------------------------------------

  async stageFiles(paths: string[]): Promise<void> {
    await rpc.git.stageFiles(this.projectId, this.getTaskId(), paths);
    this.status.invalidate();
  }

  async stageAllFiles(): Promise<void> {
    await rpc.git.stageAllFiles(this.projectId, this.getTaskId());
    this.status.invalidate();
  }

  async unstageFiles(paths: string[]): Promise<void> {
    await rpc.git.unstageFiles(this.projectId, this.getTaskId(), paths);
    this.status.invalidate();
  }

  async unstageAllFiles(): Promise<void> {
    await rpc.git.unstageAllFiles(this.projectId, this.getTaskId());
    this.status.invalidate();
  }

  async discardFiles(paths: string[]): Promise<void> {
    await rpc.git.revertFiles(this.projectId, this.getTaskId(), paths);
    this.status.invalidate();
  }

  async discardAllFiles(): Promise<void> {
    await rpc.git.revertAllFiles(this.projectId, this.getTaskId());
    this.status.invalidate();
  }

  async commit(message: string) {
    const result = await rpc.git.commit(this.projectId, this.getTaskId(), message);
    if (result.success) {
      this.status.invalidate();
      this.branchStatus.invalidate();
      return ok();
    } else {
      toast.error(`Failed to commit changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  async fetchRemote() {
    const result = await rpc.git.fetch(this.projectId, this.getTaskId());
    if (result.success) {
      this.branchStatus.invalidate();
      return ok();
    } else {
      toast.error(`Failed to fetch remote changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  async push() {
    const result = await rpc.git.push(this.projectId, this.getTaskId());
    if (result.success) {
      this.branchStatus.invalidate();
      return ok();
    } else {
      const detail =
        'message' in result.error ? (result.error.message ?? result.error.type) : result.error.type;
      toast.error(`Failed to push: ${detail}`);
      return err(result.error);
    }
  }

  async publishBranch() {
    const branchName = this.branchStatus.data?.branch;
    if (!branchName) return err({ type: 'git_error' as const, message: 'No branch checked out' });
    const result = await rpc.git.publishBranch(this.projectId, this.getTaskId(), branchName);
    if (result.success) {
      this.branchStatus.invalidate();
      return ok();
    } else {
      const detail =
        'message' in result.error ? (result.error.message ?? result.error.type) : result.error.type;
      toast.error(`Failed to publish branch: ${detail}`);
      return err(result.error);
    }
  }

  async pull() {
    const result = await rpc.git.pull(this.projectId, this.getTaskId());
    if (result.success) {
      this.status.invalidate();
      this.branchStatus.invalidate();
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
    const result = await rpc.git.getStatus(this.projectId, this.getTaskId());
    if (!result.success) throw new Error(result.error.type);
    const changes = result.data.changes;
    return {
      changes,
      totalLinesAdded: changes.reduce((sum, c) => sum + c.additions, 0),
      totalLinesDeleted: changes.reduce((sum, c) => sum + c.deletions, 0),
    };
  }

  private async _fetchBranchStatus(): Promise<BranchStatus> {
    const result = await rpc.git.getBranchStatus(this.projectId, this.getTaskId());
    if (!result.success) throw new Error(result.error.type);
    return result.data;
  }
}

// ---------------------------------------------------------------------------
// Keep reaction helper for PrStore and DiffViewStore that need to react to
// git file changes (replaces the old direct observable reference).
// ---------------------------------------------------------------------------
export function subscribeToGitFileChanges(git: GitStore, handler: () => void): () => void {
  return reaction(() => git.status.data, handler);
}
