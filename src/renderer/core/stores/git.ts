import { action, makeObservable, observable, runInAction } from 'mobx';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { GitChange } from '@shared/git';
import { events, rpc } from '@renderer/core/ipc';

export class GitStore {
  fileChanges: GitChange[] = [];
  stagedFileChanges: GitChange[] = [];
  unstagedFileChanges: GitChange[] = [];
  totalLinesAdded = 0;
  totalLinesDeleted = 0;
  isLoading = false;
  error: string | undefined = undefined;

  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _unsubscribe: (() => void) | null = null;

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
      load: action,
      stageFiles: action,
      stageAllFiles: action,
      unstageFiles: action,
      unstageAllFiles: action,
      discardFiles: action,
      discardAllFiles: action,
      commit: action,
    });
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
  }

  dispose(): void {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
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

  async commit(message: string): Promise<void> {
    await rpc.git.commit(this.projectId, this.taskId, message);
    await this.load();
  }
}
