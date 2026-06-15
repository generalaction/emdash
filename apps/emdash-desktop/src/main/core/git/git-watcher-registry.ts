import path from 'node:path';
import parcelWatcher from '@parcel/watcher';
import { HookCore, type Hookable } from '@main/lib/hookable';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import {
  branchRef,
  remoteRef,
  toRefString,
  type GitObjectRef,
  type GitRef,
} from '@shared/core/git/git';
import { projectManager } from '../projects/project-manager';

// Legacy Git watcher retained for SSH compatibility while SSH projects still use
// the main-process Git adapter. New Git watching should use `@emdash/shared/git`.

export type GitRefChange = {
  projectId: string;
  kind: 'local-refs' | 'remote-refs' | 'config';
  /** Specific structured refs that changed, when derivable from the FS path.
   *  Absent for packed-refs (ambiguous) and bare HEAD pointer changes. */
  changedRefs?: GitRef[];
};

export type GitWatcherHooks = {
  'ref:changed': (change: GitRefChange) => void | Promise<void>;
};

/**
 * @deprecated Use `@emdash/shared/git` (`IGitRuntime`/`GitRuntime`) for new Git watching code.
 * This registry is retained only so legacy SSH projects keep receiving Git change events
 * until SSH projects are migrated onto the shared Git runtime.
 */
class GitWatcherRegistry implements Hookable<GitWatcherHooks>, IInitializable, IDisposable {
  private readonly _hooks = new HookCore<GitWatcherHooks>((name, e) =>
    log.error(`GitWatcherRegistry: ${String(name)} hook error`, e)
  );
  private readonly _subscriptions = new Map<string, parcelWatcher.AsyncSubscription>();

  on<K extends keyof GitWatcherHooks>(name: K, handler: GitWatcherHooks[K]) {
    return this._hooks.on(name, handler);
  }

  initialize(): void {
    projectManager.on('projectOpened', (projectId, provider) => {
      if (provider.type !== 'local') return;
      void this._startWatching(projectId, provider.repoPath);
    });

    projectManager.on('projectClosed', (projectId) => {
      void this._stopWatching(projectId);
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
    try {
      const sub = await parcelWatcher.subscribe(gitDir, (_err, rawEvents) => {
        if (_err) return;
        let emitLocal = false;
        let emitRemote = false;
        let emitConfig = false;
        const changedLocalByKey = new Map<string, GitObjectRef>();
        const changedRemoteByKey = new Map<string, GitObjectRef>();

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
          this._hooks.callHookBackground('ref:changed', {
            projectId,
            kind: 'config',
          });
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
  }
}

/**
 * @deprecated Use `@emdash/shared/git` (`IGitRuntime`/`GitRuntime`) for new Git watching code.
 */
export const gitWatcherRegistry = new GitWatcherRegistry();
