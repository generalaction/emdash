import { PullRequest } from '@shared/pull-requests';
import { FilesStore } from './files-store';
import { GitStore } from './git';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';

export class WorkspaceStore {
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;

  constructor(
    projectId: string,
    workspaceId: string,
    getTaskId: () => string,
    getPrs: () => PullRequest[]
  ) {
    this.git = new GitStore(projectId, getTaskId, workspaceId);
    this.files = new FilesStore(projectId, getTaskId, workspaceId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, getTaskId, workspaceId);
    this.pr = new PrStore(projectId, taskId, this.git, getPrs);
  }

  activate(): void {
    this.git.startWatching();
    this.files.startWatching();
    this.pr.start();
  }

  dispose(): void {
    this.git.dispose();
    this.files.dispose();
    this.lifecycleScripts.dispose();
    this.pr.dispose();
  }
}
