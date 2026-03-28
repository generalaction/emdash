import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { toast } from 'sonner';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { GitChange } from '@shared/git';
import { err, ok } from '@shared/result';
import { events, rpc } from '@renderer/core/ipc';

export interface BranchStatus {
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export class GitStore {
  fileChanges: GitChange[] = [];
  stagedFileChanges: GitChange[] = [];
  unstagedFileChanges: GitChange[] = [];
  totalLinesAdded = 0;
  totalLinesDeleted = 0;
  isLoading = false;
  error: string | undefined = undefined;

  branchStatus: BranchStatus | null = null;
  branchStatusLoading = false;
  branchStatusError: string | undefined = undefined;

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _unsubscribe: (() => void) | null = null;
  private _branchStatusPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly projectId: string,
    private readonly taskId: string
  ) {
    makeObservable(this, {
      fileChanges: observable,
      stagedFileChanges: observable,
      unstagedFileChanges: observable,
      totalLinesAdded: observable,
      totalLinesDeleted: observable,
      isLoading: observable,
      error: observable,
      branchStatus: observable,
      branchStatusLoading: observable,
      branchStatusError: observable,
      load: action,
      loadBranchStatus: action,
      stageFiles: action,
      stageAllFiles: action,
      unstageFiles: action,
      unstageAllFiles: action,
      discardFiles: action,
      discardAllFiles: action,
      commit: action,
      fetchRemote: action,
      push: action,
      publishBranch: action,
      pull: action,
      isBranchPublished: computed,
      aheadCount: computed,
      behindCount: computed,
    });
  }

  get isBranchPublished(): boolean {
    return this.branchStatus?.upstream !== undefined;
  }

  get aheadCount(): number {
    return this.branchStatus?.ahead ?? 0;
  }

  get behindCount(): number {
    return this.branchStatus?.behind ?? 0;
  }

  async load(): Promise<void> {
    runInAction(() => {
      this.isLoading = true;
      this.error = undefined;
    });

    try {
      const result = await rpc.git.getStatus(this.projectId, this.taskId);
      runInAction(() => {
        if (!result.success) {
          this.error = result.error.type;
          this.isLoading = false;
          return;
        }
        const changes = result.data.changes;
        this.fileChanges = changes;
        this.stagedFileChanges = changes.filter((c) => c.isStaged);
        this.unstagedFileChanges = changes.filter((c) => !c.isStaged);
        this.totalLinesAdded = changes.reduce((sum, c) => sum + c.additions, 0);
        this.totalLinesDeleted = changes.reduce((sum, c) => sum + c.deletions, 0);
        this.isLoading = false;
      });
    } catch (e) {
      runInAction(() => {
        this.error = e instanceof Error ? e.message : String(e);
        this.isLoading = false;
      });
    }

    void this.loadBranchStatus();
  }

  async loadBranchStatus(): Promise<void> {
    runInAction(() => {
      this.branchStatusLoading = true;
      this.branchStatusError = undefined;
    });
    const result = await rpc.git.getBranchStatus(this.projectId, this.taskId);
    if (result.success) {
      runInAction(() => {
        this.branchStatus = result.data;
        this.branchStatusLoading = false;
      });
    } else {
      runInAction(() => {
        this.branchStatusError = result.error.type;
        this.branchStatusLoading = false;
      });
    }
  }

  async fetchRemote() {
    const result = await rpc.git.fetch(this.projectId, this.taskId);
    if (result.success) {
      await this.loadBranchStatus();
      return ok();
    } else {
      toast.error(`Failed to fetch remote changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  async push() {
    const result = await rpc.git.push(this.projectId, this.taskId);
    if (result.success) {
      await this.loadBranchStatus();
      return ok();
    } else {
      const detail =
        'message' in result.error ? (result.error.message ?? result.error.type) : result.error.type;
      toast.error(`Failed to push: ${detail}`);
      return err(result.error);
    }
  }

  async publishBranch() {
    const branchName = this.branchStatus?.branch;
    if (!branchName) return err({ type: 'git_error' as const, message: 'No branch checked out' });
    const result = await rpc.git.publishBranch(this.projectId, this.taskId, branchName);
    if (result.success) {
      await this.loadBranchStatus();
      return ok();
    } else {
      const detail =
        'message' in result.error ? (result.error.message ?? result.error.type) : result.error.type;
      toast.error(`Failed to publish branch: ${detail}`);
      return err(result.error);
    }
  }

  async pull() {
    const result = await rpc.git.pull(this.projectId, this.taskId);
    if (result.success) {
      await this.load();
      return ok();
    } else {
      toast.error(`Failed to pull changes: ${result.error.type} `);
      return err(result.error);
    }
  }

  startWatching(): void {
    rpc.fs.watchSetPaths(this.projectId, this.taskId, ['.git'], 'git-store').catch(() => {});

    this._unsubscribe = events.on(
      fsWatchEventChannel,
      () => {
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => void this.load(), 400);
      },
      this.taskId
    );

    this._branchStatusPollTimer = setInterval(() => {
      void this.loadBranchStatus();
    }, 10_000);
  }

  dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
    if (this._branchStatusPollTimer) {
      clearInterval(this._branchStatusPollTimer);
      this._branchStatusPollTimer = null;
    }
    this._unsubscribe?.();
    this._unsubscribe = null;
    rpc.fs.watchStop(this.projectId, this.taskId, 'git-store').catch(() => {});
  }

  async stageFiles(paths: string[]): Promise<void> {
    await rpc.git.stageFiles(this.projectId, this.taskId, paths);
    await this.load();
  }

  async stageAllFiles(): Promise<void> {
    await rpc.git.stageAllFiles(this.projectId, this.taskId);
    await this.load();
  }

  async unstageFiles(paths: string[]): Promise<void> {
    await rpc.git.unstageFiles(this.projectId, this.taskId, paths);
    await this.load();
  }

  async unstageAllFiles(): Promise<void> {
    await rpc.git.unstageAllFiles(this.projectId, this.taskId);
    await this.load();
  }

  async discardFiles(paths: string[]): Promise<void> {
    await rpc.git.revertFiles(this.projectId, this.taskId, paths);
    await this.load();
  }

  async discardAllFiles(): Promise<void> {
    await rpc.git.revertAllFiles(this.projectId, this.taskId);
    await this.load();
  }

  async commit(message: string) {
    const result = await rpc.git.commit(this.projectId, this.taskId, message);
    if (result.success) {
      await this.load();
      return ok();
    } else {
      toast.error(`Failed to commit changes: ${result.error.type} `);
      return err(result.error);
    }
  }
}
