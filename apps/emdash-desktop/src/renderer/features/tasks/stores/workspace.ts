import type { ILifecycle } from '@emdash/shared';
import { computed, makeObservable } from 'mobx';
import type { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import { appState } from '@renderer/lib/stores/app-state';
import type { ConnectionState } from '@shared/core/ssh/ssh';
import { releaseFileModelManager } from '../editor/stores/file-model-manager';
import { GitWorktreeStore } from './git-worktree-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';

export class WorkspaceStore implements ILifecycle {
  readonly workspaceId: string;
  readonly path: string;
  readonly gitRepository: GitRepositoryStore;
  readonly sshConnectionId: string | undefined;
  readonly gitWorktree: GitWorktreeStore;
  readonly lifecycleScripts: LifecycleScriptsStore;

  constructor(
    projectId: string,
    workspaceId: string,
    path: string,
    gitRepository: GitRepositoryStore,
    sshConnectionId?: string
  ) {
    makeObservable(this, { connectionState: computed });
    this.workspaceId = workspaceId;
    this.path = path;
    this.sshConnectionId = sshConnectionId;
    this.gitRepository = gitRepository;
    this.gitWorktree = new GitWorktreeStore(projectId, workspaceId, this.gitRepository);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, workspaceId);
  }

  get connectionState(): ConnectionState | null {
    if (!this.sshConnectionId) return null;
    return appState.sshConnections.stateFor(this.sshConnectionId);
  }

  reconnect(): void {
    if (this.sshConnectionId) {
      void appState.sshConnections.connect(this.sshConnectionId).catch(() => {});
    }
  }

  activate(): void {
    this.gitWorktree.start();
  }

  initialize(): void {
    this.activate();
  }

  dispose(): void {
    this.gitWorktree.dispose();
    this.lifecycleScripts.dispose();
    // Last task on this workspace has been released (ref-count hit 0 in
    // WorkspaceRegistryStore), so the per-workspace Monaco model manager and its
    // registered models can be torn down. No open editors remain at this point.
    releaseFileModelManager(this.workspaceId);
  }
}
