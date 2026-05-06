import path from 'node:path';
import parcelWatcher from '@parcel/watcher';
import {
  gitRefChangedChannel,
  gitWorkspaceChangedChannel,
  type GitRefChange,
} from '@shared/events/gitEvents';
import { branchRef, remoteRef, toRefString, type GitObjectRef } from '@shared/git';
import { events } from '@main/lib/events';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { projectManager } from '../projects/project-manager';
import { taskManager } from '../tasks/task-manager';

export type GitWatcherHooks = {
  'ref:changed': (change: GitRefChange) => void | Promise<void>;
};

class GitWatcherRegistry implements Hookable<GitWatcherHooks>, IInitializable, IDisposable {
  private readonly _hooks = new HookCore<GitWatcherHooks>((name, e) =>
    log.error(`GitWatcherRegistry: ${String(name)} hook error`, e)
  );
  private readonly _subscriptions = new Map<string, parcelWatcher.AsyncSubscription>();
  /**
   * Per-project worktree registry.
   * projectId → (workspaceId → relativeGitDir)
   */
  private readonly _worktrees = new Map<string, Map<string, string>>();

  on<K extends keyof GitWatcherHooks>(name: K, handler: GitWatcherHooks[K]) {
    return this._hooks.on(name, handler);
  }

  initialize(): void {
    // IPC bridge: forward all ref changes to the renderer.
    this._hooks.on('ref:changed', (change) => events.emit(gitRefChangedChannel, change));

    projectManager.on('projectOpened', (projectId, provider) => {
      if (provider.type !== 'local') return;
      void this._startWatching(projectId, provider.repoPath);
    });

    projectManager.on('projectClosed', (projectId) => {
      void this._stopWatching(projectId);
    });

    taskManager.hooks.on('task:provisioned', ({ projectId, workspaceId, worktreeGitDir }) => {
      if (!worktreeGitDir) return;
      this._worktrees.get(projectId)?.set(workspaceId, worktreeGitDir);
    });

    taskManager.hooks.on('task:torn-down', ({ projectId, workspaceId }) => {
      this._worktrees.get(projectId)?.delete(workspaceId);
    });
  }

  async dispose(): Promise<void> {
    const ids = [...this._subscriptions.keys()];
    try {
      await Promise.allSettled(ids.map((id) => this._stopWatching(id)));
    } catch (e) {
      log.error('Failed to stop watching git repositories:', e);
    }
  }

  private async _startWatching(projectId: string, repoPath: string): Promise<void> {
    const gitDir = path.join(repoPath, '.git');
    this._worktrees.set(projectId, new Map());
    try {
      const sub = await parcelWatcher.subscribe(gitDir, (_err, rawEvents) => {
        if (_err) return;
        let emitLocal = false;
        let emitRemote = false;
        let emitConfig = false;
        const changedLocalByKey = new Map<string, GitObjectRef>();
        const changedRemoteByKey = new Map<string, GitObjectRef>();

        const worktrees = this._worktrees.get(projectId) ?? new Map<string, string>();

        for (const e of rawEvents) {
          const rel = path.relative(gitDir, e.path).replace(/\\/g, '/');

          // Project-level ref changes
          if (rel.startsWith('refs/heads/')) {
            const branch = rel.slice('refs/heads/'.length);
            const r = branchRef({ type: 'local', branch });
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

          // Workspace-level index/HEAD changes (renderer-only, direct IPC emit)
          for (const [workspaceId, relGitDir] of worktrees) {
            const prefix = relGitDir ? `${relGitDir}/` : '';
            if (rel === `${prefix}index`) {
              events.emit(gitWorkspaceChangedChannel, { projectId, workspaceId, kind: 'index' });
            }
            if (rel === `${prefix}HEAD`) {
              events.emit(gitWorkspaceChangedChannel, { projectId, workspaceId, kind: 'head' });
            }
          }
        }

        if (emitLocal) {
          const changedRefs =
            changedLocalByKey.size > 0 ? [...changedLocalByKey.values()] : undefined;
          this._hooks.callHookBackground('ref:changed', {
            projectId,
            kind: 'local-refs',
            changedRefs,
          });
        }
        if (emitRemote) {
          const changedRefs =
            changedRemoteByKey.size > 0 ? [...changedRemoteByKey.values()] : undefined;
          this._hooks.callHookBackground('ref:changed', {
            projectId,
            kind: 'remote-refs',
            changedRefs,
          });
        }
        if (emitConfig) {
          this._hooks.callHookBackground('ref:changed', { projectId, kind: 'config' });
        }
      });
      this._subscriptions.set(projectId, sub);
    } catch {
      // Subscription failed (e.g. project path removed or .git directory missing).
    }
  }

  private async _stopWatching(projectId: string): Promise<void> {
    await this._subscriptions.get(projectId)?.unsubscribe();
    this._subscriptions.delete(projectId);
    this._worktrees.delete(projectId);
  }
}

export const gitWatcherRegistry = new GitWatcherRegistry();
