import path from 'node:path';
import parcelWatcher from '@parcel/watcher';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import { events } from '@main/lib/events';

export class GitWatcherService {
  private sub: parcelWatcher.AsyncSubscription | null = null;

  /**
   * Registered worktrees. Maps workspaceId → git-dir path relative to the
   * repo's .git directory.
   *   Main workspace → ''
   *   Linked worktree → 'worktrees/<basename>'
   */
  private readonly _worktrees = new Map<string, string>();

  constructor(
    private readonly projectId: string,
    private readonly repoPath: string
  ) {}

  /**
   * Register a workspace so that index/HEAD changes inside its git dir are
   * emitted as gitWorkspaceChangedChannel events.
   *
   * @param workspaceId  The renderer-side workspace key.
   * @param relativeGitDir  Path of the worktree's git dir relative to .git/.
   *   Pass '' for the main worktree; 'worktrees/<name>' for linked worktrees.
   */
  registerWorktree(workspaceId: string, relativeGitDir: string): void {
    this._worktrees.set(workspaceId, relativeGitDir);
  }

  unregisterWorktree(workspaceId: string): void {
    this._worktrees.delete(workspaceId);
  }

  async start(): Promise<void> {
    const gitDir = path.join(this.repoPath, '.git');
    try {
      this.sub = await parcelWatcher.subscribe(gitDir, (_err, rawEvents) => {
        if (_err) return;
        let emitLocal = false;
        let emitRemote = false;
        let emitConfig = false;
        for (const e of rawEvents) {
          const rel = path.relative(gitDir, e.path).replace(/\\/g, '/');

          // Project-level ref changes
          if (rel.startsWith('refs/heads/') || rel === 'HEAD') emitLocal = true;
          if (rel.startsWith('refs/remotes/')) emitRemote = true;
          if (rel === 'packed-refs') {
            emitLocal = true;
            emitRemote = true;
          }
          if (rel === 'config') emitConfig = true;

          // Workspace-level index/HEAD changes
          for (const [workspaceId, relGitDir] of this._worktrees) {
            const prefix = relGitDir ? `${relGitDir}/` : '';
            if (rel === `${prefix}index`) {
              events.emit(gitWorkspaceChangedChannel, {
                projectId: this.projectId,
                workspaceId,
                kind: 'index',
              });
            }
            // HEAD but not refs/heads/* (that's a branch pointer update, not a checkout)
            if (rel === `${prefix}HEAD`) {
              events.emit(gitWorkspaceChangedChannel, {
                projectId: this.projectId,
                workspaceId,
                kind: 'head',
              });
            }
          }
        }
        if (emitLocal) {
          events.emit(gitRefChangedChannel, { projectId: this.projectId, kind: 'local-refs' });
        }
        if (emitRemote) {
          events.emit(gitRefChangedChannel, { projectId: this.projectId, kind: 'remote-refs' });
        }
        if (emitConfig) {
          events.emit(gitRefChangedChannel, { projectId: this.projectId, kind: 'config' });
        }
      });
    } catch {
      // Subscription failed (e.g. project path removed or .git directory missing).
    }
  }

  async stop(): Promise<void> {
    await this.sub?.unsubscribe();
    this.sub = null;
  }
}
