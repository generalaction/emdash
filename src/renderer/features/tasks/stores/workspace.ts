import { observable } from 'mobx';
import type { RepositoryStore } from '@renderer/features/projects/stores/repository-store';
import { GitStore } from '../diff-view/stores/git-store';
import { FilesStore } from '../editor/stores/files-store';
import { LifecycleScriptsStore } from './lifecycle-scripts';
import { PrStore } from './pr-store';
import type { TaskStore } from './task';

export class WorkspaceStore {
  readonly tasks = observable.array<TaskStore>();
  git: GitStore;
  files: FilesStore;
  lifecycleScripts: LifecycleScriptsStore;
  pr: PrStore;

  constructor(
    projectId: string,
    workspaceId: string,
    initialTasks: TaskStore[],
    repositoryStore: RepositoryStore
  ) {
    this.tasks.replace(initialTasks);
    this.git = new GitStore(projectId, workspaceId, repositoryStore);
    this.files = new FilesStore(projectId, workspaceId);
    this.lifecycleScripts = new LifecycleScriptsStore(projectId, workspaceId);
    this.pr = new PrStore(projectId, workspaceId, repositoryStore, this.tasks);
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
    this.git.dispose();
    this.files.dispose();
    this.lifecycleScripts.dispose();
    this.pr.dispose();
  }
}
