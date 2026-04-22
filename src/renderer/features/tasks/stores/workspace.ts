import type { PullRequest } from '@shared/pull-requests';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { rpc } from '@renderer/lib/ipc';
import { Resource } from '@renderer/lib/stores/resource';
import { GitStore } from '../diff-view/stores/git-store';
import { FilesStore } from '../editor/stores/files-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';

export class WorkspaceStore {
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;
  readonly nameWithOwner: Resource<string | null>;

  constructor(
    projectId: string,
    workspaceId: string,
    taskId: string,
    repositoryStore: RepositoryStore,
    getPrs: () => PullRequest[]
  ) {
    this.git = new GitStore(projectId, workspaceId, repositoryStore);
    this.files = new FilesStore(projectId, workspaceId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, workspaceId);
    this.pr = new PrStore(projectId, workspaceId, taskId, repositoryStore, getPrs);
    this.nameWithOwner = new Resource<string | null>(async () => {
      const result = await rpc.pullRequests.getNameWithOwner(projectId);
      return result.status === 'ready' ? result.nameWithOwner : null;
    }, [{ kind: 'demand' }]);
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
    this.nameWithOwner.dispose();
  }
}
