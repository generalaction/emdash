import { computed, makeObservable } from 'mobx';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { appState } from '@renderer/lib/stores/app-state';
import type { ILifecycle } from '@renderer/lib/stores/lifecycle';
import type { ConnectionState } from '@shared/ssh';
import { GitStore } from '../diff-view/stores/git-store';
import { FilesStore } from '../editor/stores/files-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';

export class WorkspaceStore implements ILifecycle {
  readonly path: string;
  readonly repository: RepositoryStore;
  readonly sshConnectionId: string | undefined;
  readonly git: GitStore;
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
    this.repository = new RepositoryStore(projectId, settingsStore, baseRef, workspaceId);
    this.git = new GitStore(projectId, workspaceId, this.repository);
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
    this.git.startWatching();
    this.files.startWatching();
  }

  initialize(): void {
    this.activate();
  }

  dispose(): void {
    this.repository.dispose();
    this.git.dispose();
    this.files.dispose();
    this.lifecycleScripts.dispose();
  }
}
