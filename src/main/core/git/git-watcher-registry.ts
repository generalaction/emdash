import { projectManager } from '../projects/project-manager';
import { taskManager } from '../tasks/task-manager';
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
    taskManager.hooks.on('task:provisioned', ({ projectId, workspaceId, worktreeGitDir }) => {
      if (!worktreeGitDir) return;
      this._watchers.get(projectId)?.registerWorktree(workspaceId, worktreeGitDir);
    });
    taskManager.hooks.on('task:torn-down', ({ projectId, workspaceId }) => {
      this._watchers.get(projectId)?.unregisterWorktree(workspaceId);
    });
  }

  get(projectId: string): GitWatcherService | undefined {
    return this._watchers.get(projectId);
  }
}

export const gitWatcherRegistry = new GitWatcherRegistry();
