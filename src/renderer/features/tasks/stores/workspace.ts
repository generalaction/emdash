import { computed, observable } from 'mobx';
import type { ConnectionState } from '@shared/ssh';
import type { ProjectSettingsStore } from '@renderer/features/projects/stores/project-settings-store';
import { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { appState } from '@renderer/lib/stores/app-state';
import { GitStore } from '../diff-view/stores/git-store';
import { FilesStore } from '../editor/stores/files-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';
import type { TaskStore } from './task';

export class WorkspaceStore {
  readonly tasks = observable.array<TaskStore>();
  readonly repository: RepositoryStore;
  readonly sshConnectionId: string | undefined;
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;

  constructor(
    projectId: string,
    workspaceId: string,
    initialTasks: TaskStore[],
    settingsStore: ProjectSettingsStore,
    baseRef: string,
    sshConnectionId?: string
  ) {
    this.sshConnectionId = sshConnectionId;
    this.tasks.replace(initialTasks);
    this.repository = new RepositoryStore(projectId, settingsStore, baseRef, workspaceId);
    this.git = new GitStore(projectId, workspaceId, this.repository);
    this.files = new FilesStore(projectId, workspaceId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, workspaceId);
    this.pr = new PrStore(projectId, workspaceId, this.repository, this.tasks);
  }

  @computed get connectionState(): ConnectionState | null {
    if (!this.sshConnectionId) return null;
    return appState.sshConnections.stateFor(this.sshConnectionId);
  }

  reconnect(): void {
    if (this.sshConnectionId) {
      void appState.sshConnections.connect(this.sshConnectionId).catch(() => {});
    }
  }

  addTask(task: TaskStore): void {
    if (!this.tasks.includes(task)) this.tasks.push(task);
  }

  removeTask(task: TaskStore): void {
    const idx = this.tasks.indexOf(task);
    if (idx >= 0) this.tasks.splice(idx, 1);
  }

  activate(): void {
    this.git.startWatching();
    this.files.startWatching();
  }

  dispose(): void {
    this.repository.dispose();
    this.git.dispose();
    this.files.dispose();
    this.lifecycleScripts.dispose();
    this.pr.dispose();
  }
}
