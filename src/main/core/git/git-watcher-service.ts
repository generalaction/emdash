import path from 'node:path';
import parcelWatcher from '@parcel/watcher';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import { localRef, remoteRef, toRefString, type GitRef } from '@shared/git';
import { events } from '@main/lib/events';

export class GitWatcherService {
  private sub: parcelWatcher.AsyncSubscription | null = null;

  /**
   * Registered worktrees. Maps workspaceId → git-dir path relative to the
   * repo's .git directory (from `GitService.getWorktreeGitDir`).
   *   Main workspace → ''
   *   Linked worktree → e.g. 'worktrees/<git-admin-id>'
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
        const changedLocalByKey = new Map<string, GitRef>();
        const changedRemoteByKey = new Map<string, GitRef>();
        for (const e of rawEvents) {
          const rel = path.relative(gitDir, e.path).replace(/\\/g, '/');
          // Project-level ref changes
          if (rel.startsWith('refs/heads/')) {
            const branch = rel.slice('refs/heads/'.length);
            const r = localRef(branch);
            changedLocalByKey.set(toRefString(r), r);
            emitLocal = true;
          } else if (rel === 'HEAD') {
            emitLocal = true;
          }
          if (rel.startsWith('refs/remotes/')) {
            const full = rel.slice('refs/remotes/'.length);
            const idx = full.indexOf('/');
            if (idx > 0) {
              const r = remoteRef(full.slice(0, idx), full.slice(idx + 1));
              changedRemoteByKey.set(toRefString(r), r);
            }
            emitRemote = true;
          }
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
          const changedRefs =
            changedLocalByKey.size > 0 ? [...changedLocalByKey.values()] : undefined;
          events.emit(gitRefChangedChannel, {
            projectId: this.projectId,
            kind: 'local-refs',
            changedRefs,
          });
        }
        if (emitRemote) {
          const changedRefs =
            changedRemoteByKey.size > 0 ? [...changedRemoteByKey.values()] : undefined;
          events.emit(gitRefChangedChannel, {
            projectId: this.projectId,
            kind: 'remote-refs',
            changedRefs,
          });
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
