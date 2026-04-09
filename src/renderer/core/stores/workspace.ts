import type { PullRequest } from '@shared/pull-requests';
import { DevServerStore } from './dev-server-store';
import { FilesStore } from './files-store';
import { GitStore } from './git';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';

export class WorkspaceStore {
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;
  devServers: DevServerStore;

  constructor(projectId: string, taskId: string, getPrs: () => PullRequest[]) {
    this.git = new GitStore(projectId, taskId);
    this.files = new FilesStore(projectId, taskId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, taskId);
    this.pr = new PrStore(projectId, taskId, this.git, getPrs);
    this.devServers = new DevServerStore(taskId);
  }

  dispose(): void {
    this.git.dispose();
    this.files.dispose();
    this.pr.dispose();
    this.devServers.dispose();
  }
}
