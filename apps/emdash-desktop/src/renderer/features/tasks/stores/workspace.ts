import { computed, makeObservable } from 'mobx';
import { GitRepositoryStore } from '@renderer/features/projects/stores/git-repository-store';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import { appState } from '@renderer/lib/stores/app-state';
import type { ILifecycle } from '@renderer/lib/stores/lifecycle';
import type { ConnectionState } from '@shared/core/ssh/ssh';
import { GitWorktreeStore } from '../diff-view/stores/git-worktree-store';
import { FilesStore } from '../editor/stores/files-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';

export class WorkspaceStore implements ILifecycle {
  readonly path: string;
  readonly gitRepository: GitRepositoryStore;
  readonly sshConnectionId: string | undefined;
  readonly gitWorktree: GitWorktreeStore;
  readonly files: FilesStore;
  readonly lifecycleScripts: LifecycleScriptsStore;

  constructor(
    projectId: string,
    workspaceId: string,
    path: string,
    settingsStore: ProjectSettingsStore,
    baseRef: string,
    sshConnectionId?: string
  ) {
    makeObservable(this, { connectionState: computed });
    this.path = path;
    this.sshConnectionId = sshConnectionId;
    this.gitRepository = new GitRepositoryStore(projectId, settingsStore, baseRef);
    this.gitWorktree = new GitWorktreeStore(projectId, workspaceId, this.gitRepository);
    this.files = new FilesStore(projectId, workspaceId);
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
    this.gitWorktree.startWatching();
    this.files.startWatching();
  }

  initialize(): void {
    this.activate();
  }

  dispose(): void {
    this.gitRepository.dispose();
    this.gitWorktree.dispose();
    this.files.dispose();
    this.lifecycleScripts.dispose();
  }
}
