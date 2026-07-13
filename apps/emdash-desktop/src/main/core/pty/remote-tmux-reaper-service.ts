import type { Disposable } from '@emdash/shared/concurrency';
import { projectManager } from '@main/core/projects/project-manager';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { log } from '@main/lib/logger';
import { reconcileProjectTmuxSessions } from './tmux-reconcile';

/**
 * Reaps orphaned `emdash-*` tmux sessions on a remote host when an SSH project
 * is mounted. These accumulate when conversations/terminals are deleted while
 * detached, or when the app restarts and loses the in-memory session tracking
 * that the explicit Stop/Delete paths rely on (issue #2580).
 *
 * Runs once per SSH project open, in the background, and never blocks the mount.
 * Preserve-on-close resumability is untouched: only sessions that no longer map
 * to any DB entity are removed.
 */
export class RemoteTmuxReaperService implements Disposable {
  private _unsubscribe: (() => void) | null = null;

  initialize(): void {
    this._unsubscribe = projectManager.on('projectOpened', (_projectId, provider) => {
      this.onProjectMounted(provider);
    });
  }

  dispose(): void {
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  private onProjectMounted(provider: ProjectProvider): void {
    if (provider.type !== 'ssh') return;
    void reconcileProjectTmuxSessions(provider.ctx, provider.projectId).catch((err) => {
      log.warn('RemoteTmuxReaperService: reconcile failed', {
        projectId: provider.projectId,
        error: String(err),
      });
    });
  }
}

export const remoteTmuxReaperService = new RemoteTmuxReaperService();
