import { projectManager } from '../projects/project-manager';
import { GitWatcherService } from './git-watcher-service';

export class GitWatcherRegistry {
  private readonly _watchers = new Map<string, GitWatcherService>();

  initialize(): void {
    projectManager.on('projectOpened', (projectId, provider) => {
      if (provider.type !== 'local') return;
      const watcher = new GitWatcherService(projectId, provider.repoPath);
      void watcher.start();
      this._watchers.set(projectId, watcher);
    });
    projectManager.on('projectClosed', (projectId) => {
      const watcher = this._watchers.get(projectId);
      if (!watcher) return;
      void watcher.stop();
      this._watchers.delete(projectId);
    });
  }

  get(projectId: string): GitWatcherService | undefined {
    return this._watchers.get(projectId);
  }
}

export const gitWatcherRegistry = new GitWatcherRegistry();
