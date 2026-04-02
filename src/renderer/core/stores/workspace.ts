import { FilesStore } from './files-store';
import { GitStore } from './git';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';

export class WorkspaceStore {
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;

  constructor(projectId: string, taskId: string) {
    this.git = new GitStore(projectId, taskId);
    this.files = new FilesStore(projectId, taskId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, taskId);
    this.pr = new PrStore(projectId, taskId, this.git);
  }
}
