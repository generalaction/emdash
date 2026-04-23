import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { GitStore } from '../diff-view/stores/git-store';
import { FilesStore } from '../editor/stores/files-store';
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
    taskId: string,
    taskBranch: string | undefined,
    repositoryStore: RepositoryStore
  ) {
    this.git = new GitStore(projectId, workspaceId, repositoryStore);
    this.files = new FilesStore(projectId, workspaceId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, workspaceId);
    this.pr = new PrStore(projectId, workspaceId, taskId, taskBranch, repositoryStore);
  }

  activate(): void {
    this.git.startWatching();
    this.files.startWatching();
  }

  dispose(): void {
    this.git.dispose();
    this.files.dispose();
    this.lifecycleScripts.dispose();
    this.pr.dispose();
  }
}
