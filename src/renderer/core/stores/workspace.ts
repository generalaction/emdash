import { FilesStore } from './files-store';
import { GitStore } from './git';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';

export class WorkspaceStore {
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;

  constructor(projectId: string, taskId: string, workspaceId: string) {
    this.git = new GitStore(projectId, taskId, workspaceId);
    this.files = new FilesStore(projectId, taskId, workspaceId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, taskId, workspaceId);
    this.pr = new PrStore(projectId, taskId, this.git);
  }
}
